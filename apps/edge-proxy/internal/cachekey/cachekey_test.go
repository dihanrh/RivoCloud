package cachekey

import "testing"

func TestBuild_QueryParamOrderDoesNotChangeKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/search", "a=1&b=2")
	b := Build("zone1", "GET", "cdn.example.com", "/search", "b=2&a=1")
	if a != b {
		t.Fatalf("expected identical keys, got %q and %q", a, b)
	}
}

func TestBuild_DifferentHostOrPathChangesKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/a", "")
	b := Build("zone1", "GET", "cdn.example.com", "/b", "")
	if a == b {
		t.Fatal("expected different paths to produce different keys")
	}
}

func TestBuild_HostIsNormalized(t *testing.T) {
	a := Build("zone1", "GET", "CDN.Example.com:443", "/a", "")
	b := Build("zone1", "GET", "cdn.example.com", "/a", "")
	if a != b {
		t.Fatal("expected host case and port to be normalized away")
	}
}

func TestBuild_PathSlashesCollapsed(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "//a///b", "")
	b := Build("zone1", "GET", "cdn.example.com", "/a/b", "")
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
	noQuery := Build("zone1", "GET", "cdn.example.com", "/path", "")
	malformedQuery := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off")
	if noQuery == malformedQuery {
		t.Fatal("expected a malformed query string to not collide with no query string at all")
	}
}

func TestBuild_PercentEncodedSeparatorDoesNotCollideWithRealSeparator(t *testing.T) {
	// "?a=b%26c%3Dd" is ONE param whose value is literally "b&c=d";
	// "?a=b&c=d" is TWO params. The raw query is forwarded to the origin
	// unchanged, so the origin legitimately returns different content for
	// each — they must never share a cache key.
	escaped := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd")
	unescaped := Build("zone1", "GET", "cdn.example.com", "/p", "a=b&c=d")
	if escaped == unescaped {
		t.Fatal("expected a percent-encoded separator inside a value to produce a different key than a real separator")
	}
}

func TestBuild_PercentEncodedValueIsDeterministic(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd")
	b := Build("zone1", "GET", "cdn.example.com", "/p", "a=b%26c%3Dd")
	if a != b {
		t.Fatal("expected the same percent-encoded query to produce the same key both times")
	}
}

func TestBuild_EquivalentEncodingsOfTheSameValueShareAKey(t *testing.T) {
	// "%2F" and "/" both decode to "/", so these are the same request and
	// should share one cache entry — re-escaping canonicalizes them.
	a := Build("zone1", "GET", "cdn.example.com", "/p", "path=%2Fx")
	b := Build("zone1", "GET", "cdn.example.com", "/p", "path=/x")
	if a != b {
		t.Fatal("expected equivalent encodings of the same value to share a cache key")
	}
}

func TestBuild_MalformedQueryIsDeterministic(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off")
	b := Build("zone1", "GET", "cdn.example.com", "/path", "q=50%off")
	if a != b {
		t.Fatal("expected the same malformed query string to produce the same key both times")
	}
}
