package signedurl

import (
	"errors"
	"net/url"
	"strconv"
	"testing"
	"time"
)

// The same vectors are asserted by apps/cdn-service/src/signing/url-signer.test.ts
// — if either side changes the message format, both suites fail.
func TestSign_MatchesTheSharedFixedVectors(t *testing.T) {
	cases := []struct{ path, want string }{
		{"/private/video.mp4", "1a2526b473b7f12e9dfb7e7681b9a3964adbb78b6e5d5dff2f3292c5bd8d5ccf"},
		{"/reports/q3 2026.pdf", "bd291068e818939a885b9feb4d5ddf6aaa642f335df18253cc34d6522eaa7293"},
	}
	for _, c := range cases {
		if got := Sign("test-secret", c.path, "1753456789"); got != c.want {
			t.Errorf("Sign(%q) = %s, want %s", c.path, got, c.want)
		}
	}
}

func signedQuery(secret, path string, expires int64) url.Values {
	e := strconv.FormatInt(expires, 10)
	return url.Values{"expires": {e}, "sig": {Sign(secret, path, e)}}
}

func TestVerify(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	future := now.Add(15 * time.Minute).Unix()
	valid := signedQuery("s3cret", "/a.txt", future)

	t.Run("accepts a valid signature and reports its expiry", func(t *testing.T) {
		expiresAt, err := Verify(valid, "/a.txt", "s3cret", now)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if expiresAt.Unix() != future {
			t.Fatalf("expiresAt = %v, want %d", expiresAt, future)
		}
	})

	t.Run("accepts an uppercase-hex signature", func(t *testing.T) {
		q := url.Values{"expires": valid["expires"], "sig": {toUpper(valid.Get("sig"))}}
		if _, err := Verify(q, "/a.txt", "s3cret", now); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("is still valid in the exact second it expires", func(t *testing.T) {
		if _, err := Verify(valid, "/a.txt", "s3cret", time.Unix(future, 0)); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	cases := []struct {
		name   string
		query  url.Values
		path   string
		secret string
		now    time.Time
		want   error
	}{
		{"no secret fails closed", valid, "/a.txt", "", now, ErrNoSecret},
		{"missing sig", url.Values{"expires": valid["expires"]}, "/a.txt", "s3cret", now, ErrMissing},
		{"missing expires", url.Values{"sig": valid["sig"]}, "/a.txt", "s3cret", now, ErrMissing},
		{"non-numeric expires", url.Values{"expires": {"soon"}, "sig": valid["sig"]}, "/a.txt", "s3cret", now, ErrBadExpires},
		{"expired", valid, "/a.txt", "s3cret", time.Unix(future+1, 0), ErrExpired},
		{"different path", valid, "/b.txt", "s3cret", now, ErrBadSignature},
		{"different secret", valid, "/a.txt", "rotated", now, ErrBadSignature},
		{"extended expiry", url.Values{"expires": {strconv.FormatInt(future+3600, 10)}, "sig": valid["sig"]}, "/a.txt", "s3cret", now, ErrBadSignature},
		{"re-encoded expiry", url.Values{"expires": {"+" + valid.Get("expires")}, "sig": valid["sig"]}, "/a.txt", "s3cret", now, ErrBadSignature},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := Verify(c.query, c.path, c.secret, c.now); !errors.Is(err, c.want) {
				t.Fatalf("err = %v, want %v", err, c.want)
			}
		})
	}
}

func toUpper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}

func TestStrip(t *testing.T) {
	cases := map[string]string{
		"":                                    "",
		"expires=1&sig=abc":                   "",
		"w=200&expires=1&sig=abc&h=100":       "w=200&h=100",
		"expires=1&download=1&filename=a.pdf": "",
		"sig=abc&v=%20x&sig=dup":              "v=%20x",
		"%73ig=abc&a=1":                       "a=1",
		"flag&expires=1":                      "flag",
		"signature=keep":                      "signature=keep",
	}
	for in, want := range cases {
		if got := Strip(in); got != want {
			t.Errorf("Strip(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestContentDisposition(t *testing.T) {
	cases := []struct {
		query  url.Values
		want   string
		wantOK bool
	}{
		{url.Values{}, "", false},
		{url.Values{"download": {"0"}}, "", false},
		{url.Values{"download": {"1"}}, "attachment", true},
		{url.Values{"download": {"1"}, "filename": {"report.pdf"}}, `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`, true},
		{url.Values{"filename": {"my report.pdf"}}, `inline; filename="my report.pdf"; filename*=UTF-8''my%20report.pdf`, true},
		{url.Values{"download": {"1"}, "filename": {"a\"b\\c\r\nX-Evil: 1.txt"}}, `attachment; filename="abcX-Evil: 1.txt"; filename*=UTF-8''abcX-Evil%3A%201.txt`, true},
		{url.Values{"download": {"1"}, "filename": {"résumé.pdf"}}, `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`, true},
		{url.Values{"download": {"1"}, "filename": {"\r\n"}}, "attachment", true},
	}
	for _, c := range cases {
		got, ok := ContentDisposition(c.query)
		if got != c.want || ok != c.wantOK {
			t.Errorf("ContentDisposition(%v) = (%q, %v), want (%q, %v)", c.query, got, ok, c.want, c.wantOK)
		}
	}
}

func TestCapCacheControl(t *testing.T) {
	cases := []struct {
		in        string
		remaining time.Duration
		want      string
	}{
		{"", 10 * time.Minute, "private, max-age=600"},
		{"public, max-age=3600", 10 * time.Minute, "private, max-age=600"},
		{"public, max-age=60", 10 * time.Minute, "private, max-age=60"},
		{"max-age=3600, s-maxage=86400, must-revalidate", 10 * time.Minute, "private, max-age=600, must-revalidate"},
		{"no-cache", 10 * time.Minute, "private, max-age=600, no-cache"},
		{"no-store", 10 * time.Minute, "no-store"},
		{"private, no-store", 10 * time.Minute, "private, no-store"},
		{`Max-Age="120"`, 10 * time.Minute, "private, max-age=120"},
		{"max-age", 10 * time.Minute, "private, max-age=600"},
		{"public, max-age=3600", -time.Second, "private, max-age=0"},
		{"public, max-age=3600", 1500 * time.Millisecond, "private, max-age=1"},
	}
	for _, c := range cases {
		if got := CapCacheControl(c.in, c.remaining); got != c.want {
			t.Errorf("CapCacheControl(%q, %v) = %q, want %q", c.in, c.remaining, got, c.want)
		}
	}
}
