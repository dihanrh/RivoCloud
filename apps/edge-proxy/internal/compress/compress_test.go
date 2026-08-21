package compress

import (
	"bytes"
	"compress/gzip"
	"io"
	"testing"
)

func TestIsCompressible_TextTypesAreCompressible(t *testing.T) {
	cases := []string{"text/html", "text/html; charset=utf-8", "application/json", "text/css"}
	for _, ct := range cases {
		if !IsCompressible(ct) {
			t.Errorf("expected %q to be compressible", ct)
		}
	}
}

func TestIsCompressible_BinaryTypesAreNotCompressible(t *testing.T) {
	cases := []string{"image/png", "video/mp4", "application/zip"}
	for _, ct := range cases {
		if IsCompressible(ct) {
			t.Errorf("expected %q to not be compressible", ct)
		}
	}
}

func TestAcceptsGzip_TrueWhenGzipListed(t *testing.T) {
	if !AcceptsGzip("gzip, deflate, br") {
		t.Fatal("expected gzip to be accepted")
	}
	if !AcceptsGzip("br, gzip;q=0.8") {
		t.Fatal("expected gzip with q-value to be accepted")
	}
}

func TestAcceptsGzip_FalseWhenNotListed(t *testing.T) {
	if AcceptsGzip("br, deflate") {
		t.Fatal("expected gzip to not be accepted")
	}
	if AcceptsGzip("") {
		t.Fatal("expected empty Accept-Encoding to not accept gzip")
	}
}

func TestGzip_ProducesValidGzipStream(t *testing.T) {
	compressed, err := Gzip([]byte("hello world"))
	if err != nil {
		t.Fatal(err)
	}
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	decompressed, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if string(decompressed) != "hello world" {
		t.Fatalf("expected round-trip to preserve content, got %q", decompressed)
	}
}
