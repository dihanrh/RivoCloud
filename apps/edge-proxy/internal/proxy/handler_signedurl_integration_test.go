//go:build integration

package proxy

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/signedurl"
	"rivocloud/edge-proxy/internal/zone"
)

const testSigningSecret = "zone-signing-secret"

// recordingOrigin answers every request with a canned cacheable body and
// remembers the query string each request reached the origin with.
type recordingOrigin struct {
	cacheControl string
	queries      []string
}

func (o *recordingOrigin) Do(req *http.Request) (*http.Response, error) {
	o.queries = append(o.queries, req.URL.RawQuery)
	cc := o.cacheControl
	if cc == "" {
		cc = "public, max-age=3600"
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Cache-Control": {cc}, "Content-Type": {"application/pdf"}},
		Body:       io.NopCloser(bytes.NewReader([]byte("private bytes"))),
	}, nil
}

type signedFixture struct {
	handler *CachingHandler
	origin  *recordingOrigin
	events  *fakeEventPublisher
	now     time.Time
}

func newSignedFixture(t *testing.T, cfg zone.Config) *signedFixture {
	t.Helper()
	memory, err := cachestore.NewMemory(10)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	origin := &recordingOrigin{}
	events := &fakeEventPublisher{}
	if cfg.ID == "" {
		cfg = zone.Config{ID: "z1", Host: "private.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour, SignedURLsRequired: true, SigningSecret: testSigningSecret}
	}
	return &signedFixture{
		handler: &CachingHandler{
			Zones:     zone.NewStaticRegistry([]zone.Config{cfg}),
			Layers:    []cachestore.Layer{memory},
			Origin:    origin,
			Now:       func() time.Time { return now },
			Analytics: events,
		},
		origin: origin,
		events: events,
		now:    now,
	}
}

func signedTarget(path, rawPath string, expires int64, extra string) string {
	e := strconv.FormatInt(expires, 10)
	target := "http://private.test" + rawPath + "?expires=" + e + "&sig=" + signedurl.Sign(testSigningSecret, path, e)
	if extra != "" {
		target += "&" + extra
	}
	return target
}

func (f *signedFixture) get(target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestSignedURL_ValidSignatureIsServedAndParamsNeverReachTheOrigin(t *testing.T) {
	f := newSignedFixture(t, zone.Config{})
	rec := f.get(signedTarget("/reports/q3 2026.pdf", "/reports/q3%202026.pdf", f.now.Add(10*time.Minute).Unix(), "w=1"))

	if rec.Code != http.StatusOK || rec.Body.String() != "private bytes" {
		t.Fatalf("expected 200 with the object, got %d %q", rec.Code, rec.Body.String())
	}
	if len(f.origin.queries) != 1 || f.origin.queries[0] != "w=1" {
		t.Fatalf("expected the origin to see only the non-signing params, got %v", f.origin.queries)
	}
}

func TestSignedURL_RejectsBadSignaturesWith403(t *testing.T) {
	future := time.Unix(1_800_000_000, 0).Add(10 * time.Minute).Unix()
	cases := map[string]string{
		"no params":        "http://private.test/a.pdf",
		"expired":          signedTarget("/a.pdf", "/a.pdf", time.Unix(1_800_000_000, 0).Add(-time.Second).Unix(), ""),
		"other path":       signedTarget("/a.pdf", "/b.pdf", future, ""),
		"tampered sig":     "http://private.test/a.pdf?expires=" + strconv.FormatInt(future, 10) + "&sig=" + signedurl.Sign("wrong-secret", "/a.pdf", strconv.FormatInt(future, 10)),
		"extended expires": "http://private.test/a.pdf?expires=" + strconv.FormatInt(future+3600, 10) + "&sig=" + signedurl.Sign(testSigningSecret, "/a.pdf", strconv.FormatInt(future, 10)),
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			f := newSignedFixture(t, zone.Config{})
			rec := f.get(target)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d", rec.Code)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("expected the 403 to be marked no-store, got %q", rec.Header().Get("Cache-Control"))
			}
			if len(f.origin.queries) != 0 {
				t.Fatalf("expected the origin never to be contacted, got %d calls", len(f.origin.queries))
			}
			if len(f.events.events) != 1 || f.events.events[0].StatusCode != http.StatusForbidden || f.events.events[0].CacheStatus != "BYPASS" {
				t.Fatalf("expected one 403 BYPASS analytics event, got %+v", f.events.events)
			}
		})
	}
}

func TestSignedURL_RejectsEveryMethodWithoutASignature(t *testing.T) {
	f := newSignedFixture(t, zone.Config{})
	for _, method := range []string{http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions} {
		rec := httptest.NewRecorder()
		f.handler.ServeHTTP(rec, httptest.NewRequest(method, "http://private.test/a.pdf", nil))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: expected 403, got %d", method, rec.Code)
		}
	}
	if len(f.origin.queries) != 0 {
		t.Fatalf("expected no origin calls, got %d", len(f.origin.queries))
	}
}

func TestSignedURL_DifferentSignaturesShareOneCacheEntry(t *testing.T) {
	f := newSignedFixture(t, zone.Config{})
	first := f.get(signedTarget("/a.pdf", "/a.pdf", f.now.Add(5*time.Minute).Unix(), ""))
	second := f.get(signedTarget("/a.pdf", "/a.pdf", f.now.Add(20*time.Minute).Unix(), "download=1"))

	if first.Header().Get("X-RivoCloud-Cache") != "MISS" || second.Header().Get("X-RivoCloud-Cache") != "HIT" {
		t.Fatalf("expected MISS then HIT, got %q then %q", first.Header().Get("X-RivoCloud-Cache"), second.Header().Get("X-RivoCloud-Cache"))
	}
	if len(f.origin.queries) != 1 {
		t.Fatalf("expected a single origin fetch, got %d", len(f.origin.queries))
	}
}

func TestSignedURL_CapsDownstreamCachingAtTheSignatureExpiry(t *testing.T) {
	f := newSignedFixture(t, zone.Config{})
	rec := f.get(signedTarget("/a.pdf", "/a.pdf", f.now.Add(10*time.Minute).Unix(), ""))
	if got := rec.Header().Get("Cache-Control"); got != "private, max-age=600" {
		t.Fatalf("expected Cache-Control capped to the 600s left on the signature, got %q", got)
	}
}

func TestSignedURL_DownloadModifiersSetContentDisposition(t *testing.T) {
	f := newSignedFixture(t, zone.Config{})
	rec := f.get(signedTarget("/a.pdf", "/a.pdf", f.now.Add(time.Minute).Unix(), "download=1&filename=report.pdf"))
	want := `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
	if got := rec.Header().Get("Content-Disposition"); got != want {
		t.Fatalf("Content-Disposition = %q, want %q", got, want)
	}
}

func TestSignedURL_ZoneWithoutASecretFailsClosed(t *testing.T) {
	f := newSignedFixture(t, zone.Config{ID: "z1", Host: "private.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour, SignedURLsRequired: true})
	if rec := f.get(signedTarget("/a.pdf", "/a.pdf", f.now.Add(time.Minute).Unix(), "")); rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from a zone with no secret, got %d", rec.Code)
	}
}

func TestSignedURL_UnsignedZonesAreUnaffected(t *testing.T) {
	f := newSignedFixture(t, zone.Config{ID: "z1", Host: "private.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour})
	rec := f.get("http://private.test/a.pdf?expires=1&sig=junk")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected an unsigned zone to ignore signing params, got %d", rec.Code)
	}
	if len(f.origin.queries) != 1 || f.origin.queries[0] != "expires=1&sig=junk" {
		t.Fatalf("expected params to pass through untouched on an unsigned zone, got %v", f.origin.queries)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.HasPrefix(got, "public") {
		t.Fatalf("expected the normal public Cache-Control on an unsigned zone, got %q", got)
	}
}
