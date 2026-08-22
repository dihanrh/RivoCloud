package httpcache

import (
	"net/http"
	"testing"
	"time"
)

func decideAt(t *testing.T, headers map[string]string, zoneDefault time.Duration) Decision {
	t.Helper()
	h := http.Header{}
	for k, v := range headers {
		h.Set(k, v)
	}
	return Decide(h, zoneDefault, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
}

func TestDecide_NoStoreIsNeverCacheable(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "no-store"}, time.Hour)
	if d.Cacheable {
		t.Fatal("expected no-store to be non-cacheable")
	}
}

func TestDecide_PrivateIsNeverCacheable(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "private"}, time.Hour)
	if d.Cacheable {
		t.Fatal("expected private to be non-cacheable")
	}
}

func TestDecide_NoCacheMustRevalidateWithZeroTTL(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "no-cache"}, time.Hour)
	if !d.Cacheable || !d.MustRevalidate || d.TTL != 0 {
		t.Fatalf("expected cacheable+must-revalidate+TTL 0, got %+v", d)
	}
}

func TestDecide_MaxAgeWins(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=120"}, time.Hour)
	if !d.Cacheable || d.TTL != 120*time.Second {
		t.Fatalf("expected TTL 120s, got %+v", d)
	}
}

func TestDecide_ExpiresUsedWhenNoMaxAge(t *testing.T) {
	d := decideAt(t, map[string]string{"Expires": "Thu, 01 Jan 2026 00:05:00 GMT"}, time.Hour)
	if !d.Cacheable || d.TTL != 5*time.Minute {
		t.Fatalf("expected TTL 5m from Expires, got %+v", d)
	}
}

func TestDecide_ZoneDefaultWhenOriginSendsNoFreshnessHeader(t *testing.T) {
	d := decideAt(t, map[string]string{}, 30*time.Minute)
	if !d.Cacheable || d.TTL != 30*time.Minute {
		t.Fatalf("expected zone default TTL, got %+v", d)
	}
}

func TestDecide_StaleIfErrorDefaultsTo24Hours(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=60"}, time.Hour)
	if d.StaleIfErrorTTL != DefaultStaleIfError {
		t.Fatalf("expected default stale-if-error of 24h, got %s", d.StaleIfErrorTTL)
	}
}

func TestDecide_OriginStaleIfErrorOverridesDefault(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=60, stale-if-error=120"}, time.Hour)
	if d.StaleIfErrorTTL != 120*time.Second {
		t.Fatalf("expected overridden stale-if-error of 120s, got %s", d.StaleIfErrorTTL)
	}
}

func TestStorable_OnlyHeuristicallyCacheableStatusCodes(t *testing.T) {
	// RFC 9111 §4.2.2's heuristically-cacheable set.
	allowed := []int{200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501}
	for _, code := range allowed {
		if !Storable(code, http.Header{}, false) {
			t.Errorf("expected status %d to be storable", code)
		}
	}
	for _, code := range []int{201, 202, 206, 302, 303, 307, 400, 401, 403, 429, 500, 502, 503, 504} {
		if Storable(code, http.Header{}, false) {
			t.Errorf("expected status %d to never be storable", code)
		}
	}
}

func TestStorable_ForbiddenStatusIsNotStorableEvenWithLongMaxAge(t *testing.T) {
	h := http.Header{}
	h.Set("Cache-Control", "public, max-age=31536000")
	if Storable(http.StatusInternalServerError, h, false) {
		t.Fatal("expected a 500 to be non-storable no matter what its Cache-Control says")
	}
}

func TestStorable_VaryOnAnythingButAcceptEncodingIsNotStorable(t *testing.T) {
	for _, vary := range []string{"Cookie", "Accept-Encoding, Cookie", "*", "User-Agent"} {
		h := http.Header{}
		h.Set("Vary", vary)
		if Storable(http.StatusOK, h, false) {
			t.Errorf("expected Vary: %q to make a response non-storable (the edge can only vary by encoding)", vary)
		}
	}
	for _, vary := range []string{"", "Accept-Encoding", "accept-encoding", " Accept-Encoding , accept-encoding "} {
		h := http.Header{}
		if vary != "" {
			h.Set("Vary", vary)
		}
		if !Storable(http.StatusOK, h, false) {
			t.Errorf("expected Vary: %q to remain storable", vary)
		}
	}
}

func TestStorable_AuthenticatedRequestNeedsExplicitPublic(t *testing.T) {
	plain := http.Header{}
	plain.Set("Cache-Control", "max-age=600")
	if Storable(http.StatusOK, plain, true) {
		t.Fatal("expected a response to an Authorization-bearing request to be non-storable without an explicit public (RFC 9111 §3.5)")
	}

	pub := http.Header{}
	pub.Set("Cache-Control", "public, max-age=600")
	if !Storable(http.StatusOK, pub, true) {
		t.Fatal("expected an explicitly public response to stay storable even for an authenticated request")
	}
}

func TestVaryOnlyAcceptEncoding(t *testing.T) {
	for _, raw := range []string{"", "Accept-Encoding", "ACCEPT-ENCODING", "Accept-Encoding, Accept-Encoding"} {
		if !VaryOnlyAcceptEncoding(raw) {
			t.Errorf("expected %q to count as Accept-Encoding-only", raw)
		}
	}
	for _, raw := range []string{"Cookie", "*", "Accept-Encoding, Cookie"} {
		if VaryOnlyAcceptEncoding(raw) {
			t.Errorf("expected %q to NOT count as Accept-Encoding-only", raw)
		}
	}
}

func TestBrowserCacheControl_NonCacheableIsNoStore(t *testing.T) {
	got := BrowserCacheControl(Decision{Cacheable: false}, 0)
	if got != "no-store" {
		t.Fatalf("expected no-store, got %q", got)
	}
}

func TestBrowserCacheControl_CacheableUsesRemainingTTL(t *testing.T) {
	got := BrowserCacheControl(Decision{Cacheable: true}, 42*time.Second)
	if got != "public, max-age=42" {
		t.Fatalf("expected public max-age=42, got %q", got)
	}
}

func TestDecide_NegativeMaxAgeClampsToZeroInsteadOfFallingThrough(t *testing.T) {
	d := decideAt(t, map[string]string{
		"Cache-Control": "max-age=-30",
		"Expires":       "Thu, 01 Jan 2026 01:00:00 GMT",
	}, time.Hour)
	if !d.Cacheable {
		t.Fatal("expected a negative max-age to still be cacheable (Priority 2 applies, just clamped)")
	}
	if d.TTL != 0 {
		t.Fatalf("expected a negative max-age to clamp to TTL 0, got %s (did it fall through to the Expires header instead?)", d.TTL)
	}
}
