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
