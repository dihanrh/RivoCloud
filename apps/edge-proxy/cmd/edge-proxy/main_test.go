package main

import (
	"net/http"
	"testing"
	"time"
)

// A CDN edge with no timeouts anywhere leaks goroutines and connections on a
// slow origin or a slow client, and a stalled origin fetch pins a request
// forever. These assert the defaults are actually wired, not left at Go's
// zero value ("no deadline").
func TestNewOriginClient_HasAFetchTimeout(t *testing.T) {
	c := newOriginClient()
	if c == http.DefaultClient {
		t.Fatal("expected a dedicated origin client, not http.DefaultClient (which has no timeout)")
	}
	if c.Timeout != 10*time.Second {
		t.Fatalf("expected a 10s origin-fetch timeout, got %s", c.Timeout)
	}
}

func TestNewServer_HasReadWriteAndIdleTimeouts(t *testing.T) {
	srv := newServer("8888", http.NewServeMux())

	if srv.Addr != ":8888" {
		t.Fatalf("expected Addr :8888, got %q", srv.Addr)
	}
	for _, tc := range []struct {
		name string
		got  time.Duration
		want time.Duration
	}{
		{"ReadHeaderTimeout", srv.ReadHeaderTimeout, 5 * time.Second},
		{"ReadTimeout", srv.ReadTimeout, 10 * time.Second},
		{"WriteTimeout", srv.WriteTimeout, 30 * time.Second},
		{"IdleTimeout", srv.IdleTimeout, 60 * time.Second},
	} {
		if tc.got != tc.want {
			t.Errorf("expected %s of %s, got %s", tc.name, tc.want, tc.got)
		}
	}
}
