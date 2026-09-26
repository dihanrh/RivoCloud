//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/analytics"
	"rivocloud/edge-proxy/internal/zone"
)

type fakeEventPublisher struct {
	events []analytics.Event
}

func (f *fakeEventPublisher) Publish(event analytics.Event) {
	f.events = append(f.events, event)
}

func TestCachingHandler_PublishesAnalyticsEventOnCacheMiss(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", OrgID: "org1", Host: "demo.test", OriginURL: origin.URL}})
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, Datacenter: "test-dc", DefaultCountry: "ZZ"}

	req := httptest.NewRequest("GET", "http://demo.test/hello", nil)
	req.Host = "demo.test"
	req.RemoteAddr = "203.0.113.5:54321"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if len(fake.events) != 1 {
		t.Fatalf("expected exactly 1 published event, got %d", len(fake.events))
	}
	event := fake.events[0]
	if event.ZoneID != "z1" || event.OrgID != "org1" {
		t.Fatalf("unexpected zone/org attribution: %+v", event)
	}
	if event.CacheStatus != "MISS" {
		t.Fatalf("expected CacheStatus MISS, got %q", event.CacheStatus)
	}
	if event.StatusCode != http.StatusOK {
		t.Fatalf("expected StatusCode 200, got %d", event.StatusCode)
	}
	if event.BytesSent != int64(len("hello")) {
		t.Fatalf("expected BytesSent %d, got %d", len("hello"), event.BytesSent)
	}
	if event.Datacenter != "test-dc" {
		t.Fatalf("expected Datacenter test-dc, got %q", event.Datacenter)
	}
	if event.Country != "ZZ" {
		t.Fatalf("expected default Country ZZ, got %q", event.Country)
	}
	if event.ClientIPHash == "" {
		t.Fatal("expected a non-empty client_ip_hash")
	}
}

func TestCachingHandler_UnknownZoneDoesNotPublishAnEvent(t *testing.T) {
	zones := zone.NewStaticRegistry(nil)
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake}

	req := httptest.NewRequest("GET", "http://unknown.test/anything", nil)
	req.Host = "unknown.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if len(fake.events) != 0 {
		t.Fatalf("expected no published events for an unresolved zone, got %d", len(fake.events))
	}
}

func TestCachingHandler_HonorsXRivoCloudCountryHeader(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, DefaultCountry: "ZZ"}

	req := httptest.NewRequest("GET", "http://demo.test/x", nil)
	req.Host = "demo.test"
	req.Header.Set("X-RivoCloud-Country", "de")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if fake.events[0].Country != "DE" {
		t.Fatalf("expected header-provided country to be upper-cased to DE, got %q", fake.events[0].Country)
	}
}

func TestCachingHandler_IgnoresMalformedXRivoCloudCountryHeader(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})

	for _, bad := range []string{"USA", "D", "1A", "D-", "ÄÖ", " de", "de "} {
		t.Run(bad, func(t *testing.T) {
			fake := &fakeEventPublisher{}
			h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, DefaultCountry: "NL"}

			req := httptest.NewRequest("GET", "http://demo.test/x", nil)
			req.Host = "demo.test"
			req.Header.Set("X-RivoCloud-Country", bad)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if len(fake.events) != 1 {
				t.Fatalf("expected exactly 1 published event, got %d", len(fake.events))
			}
			if fake.events[0].Country != "NL" {
				t.Fatalf("expected malformed header %q to fall back to the default NL, got %q", bad, fake.events[0].Country)
			}
		})
	}
}

func TestCachingHandler_MalformedDefaultCountryFallsBackToZZ(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, DefaultCountry: "USA"}

	req := httptest.NewRequest("GET", "http://demo.test/x", nil)
	req.Host = "demo.test"
	req.Header.Set("X-RivoCloud-Country", "not-a-country")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if len(fake.events) != 1 {
		t.Fatalf("expected exactly 1 published event, got %d", len(fake.events))
	}
	if fake.events[0].Country != "ZZ" {
		t.Fatalf("expected a malformed default country to fall back to ZZ, got %q", fake.events[0].Country)
	}
}
