package cachekey

import "testing"

func TestBuild_QueryParamOrderDoesNotChangeKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/search", "a=1&b=2", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/search", "b=2&a=1", "include_all", nil)
	if a != b {
		t.Fatalf("expected identical keys, got %q and %q", a, b)
	}
}

func TestBuild_DifferentHostOrPathChangesKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/a", "", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/b", "", "include_all", nil)
	if a == b {
		t.Fatal("expected different paths to produce different keys")
	}
}

func TestBuild_HostIsNormalized(t *testing.T) {
	a := Build("zone1", "GET", "CDN.Example.com:443", "/a", "", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/a", "", "include_all", nil)
	if a != b {
		t.Fatal("expected host case and port to be normalized away")
	}
}

func TestBuild_PathSlashesCollapsed(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "//a///b", "", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/a/b", "", "include_all", nil)
	if a != b {
		t.Fatal("expected repeated slashes to collapse")
	}
}

func TestNormalizeMethod_HeadFoldsToGet(t *testing.T) {
	if got := NormalizeMethod("HEAD"); got != "GET" {
		t.Fatalf("expected HEAD to fold to GET, got %s", got)
	}
	if got := NormalizeMethod("head"); got != "GET" {
		t.Fatalf("expected lowercase head to fold to GET, got %s", got)
	}
	if got := NormalizeMethod("POST"); got != "POST" {
		t.Fatalf("expected POST to pass through unchanged, got %s", got)
	}
}

func TestBuild_MalformedQueryDoesNotCollideWithEmptyQuery(t *testing.T) {
	noQuery := Build("zone1", "GET", "cdn.example.com", "/path", "", "include_all", nil)
	malformedQuery := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off", "include_all", nil)
	if noQuery == malformedQuery {
		t.Fatal("expected a malformed query string to not collide with no query string at all")
	}
}

func TestBuild_PercentEncodedSeparatorDoesNotCollideWithRealSeparator(t *testing.T) {
	// "?a=b%26c%3Dd" is ONE param whose value is literally "b&c=d";
	// "?a=b&c=d" is TWO params. The raw query is forwarded to the origin
	// unchanged, so the origin legitimately returns different content for
	// each — they must never share a cache key.
	escaped := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd", "include_all", nil)
	unescaped := Build("zone1", "GET", "cdn.example.com", "/p", "a=b&c=d", "include_all", nil)
	if escaped == unescaped {
		t.Fatal("expected a percent-encoded separator inside a value to produce a different key than a real separator")
	}
}

func TestBuild_PercentEncodedValueIsDeterministic(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd", "include_all", nil)
	if a != b {
		t.Fatal("expected the same percent-encoded query to produce the same key both times")
	}
}

func TestBuild_EquivalentEncodingsOfTheSameValueShareAKey(t *testing.T) {
	// "%2F" and "/" both decode to "/", so these are the same request and
	// should share one cache entry — re-escaping canonicalizes them.
	a := Build("zone1", "GET", "cdn.example.com", "/p", "path=%2Fx", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/p", "path=/x", "include_all", nil)
	if a != b {
		t.Fatal("expected equivalent encodings of the same value to share a cache key")
	}
}

func TestBuild_MalformedQueryIsDeterministic(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off", "include_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off", "include_all", nil)
	if a != b {
		t.Fatal("expected the same malformed query string to produce the same key both times")
	}
}

func TestBuild_StripAllIgnoresEveryQueryParam(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/img.jpg", "v=1&utm=email", "strip_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/img.jpg", "", "strip_all", nil)
	if a != b {
		t.Fatal("expected strip_all to produce the same key regardless of query string")
	}
}

func TestBuild_WhitelistKeepsOnlyListedParams(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=2&utm=email", "whitelist", []string{"q", "page"})
	b := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=2", "whitelist", []string{"q", "page"})
	if a != b {
		t.Fatal("expected whitelist mode to ignore params not on the whitelist")
	}
	c := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=3", "whitelist", []string{"q", "page"})
	if a == c {
		t.Fatal("expected a different whitelisted param value to change the key")
	}
}

func TestBuild_WhitelistIgnoresUnlistedEvenIfOnlyParam(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/page", "_ga=tracking", "whitelist", []string{"content"})
	b := Build("zone1", "GET", "cdn.example.com", "/page", "", "whitelist", []string{"content"})
	if a != b {
		t.Fatal("expected an unlisted-only query string to normalize the same as no query string")
	}
}

func TestBuild_UnknownQueryModeFallsBackToIncludeAll(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/p", "b=2&a=1", "", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/p", "a=1&b=2", "include_all", nil)
	if a != b {
		t.Fatal("expected an empty/unknown queryMode to behave exactly like include_all")
	}
}
