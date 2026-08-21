package zone

import "testing"

func TestResolve_MatchesCaseInsensitiveHostIgnoringPort(t *testing.T) {
	r := NewStaticRegistry([]Config{
		{ID: "z1", Host: "Demo.CDN.Rivocloud.dev", OriginURL: "http://localhost:9999"},
	})

	got, ok := r.Resolve("demo.cdn.rivocloud.dev:8888")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if got.ID != "z1" {
		t.Fatalf("expected zone z1, got %s", got.ID)
	}
}

func TestResolve_UnknownHostNotFound(t *testing.T) {
	r := NewStaticRegistry([]Config{{ID: "z1", Host: "demo.cdn.rivocloud.dev"}})

	_, ok := r.Resolve("someone-else.example.com")
	if ok {
		t.Fatal("expected unknown host to not resolve")
	}
}
