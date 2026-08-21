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
