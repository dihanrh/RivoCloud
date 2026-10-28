// Package signedurl verifies the HMAC-SHA256 signed URLs the CDN Service
// issues for private objects (EDD Section 5.5), entirely from the request and
// the zone's cached signing secret, with no control-plane round-trip.
package signedurl

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	// ErrNoSecret means the zone requires signed URLs but has no secret to
	// check them with. Every request fails closed rather than falling open.
	ErrNoSecret     = errors.New("signedurl: zone has no signing secret")
	ErrMissing      = errors.New("signedurl: missing expires or sig")
	ErrBadExpires   = errors.New("signedurl: malformed expires")
	ErrExpired      = errors.New("signedurl: expired")
	ErrBadSignature = errors.New("signedurl: signature mismatch")
)

// Params are the query parameters the signing scheme owns. The edge strips
// all of them before building a cache key or forwarding to the origin.
var Params = []string{"expires", "sig", "download", "filename"}

// Sign returns the lowercase-hex HMAC-SHA256 of "{expires}:{path}", byte-for-
// byte what apps/cdn-service/src/signing/url-signer.ts's signPath produces.
func Sign(secret, path, expires string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(expires + ":" + path))
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify checks query's expires/sig against path (the DECODED r.URL.Path)
// and returns the moment the URL stops being valid. The raw expires string
// is what gets signed, so any re-encoding of it ("+123", "0123") simply
// fails the signature check instead of needing its own rule.
func Verify(query url.Values, path, secret string, now time.Time) (time.Time, error) {
	if secret == "" {
		return time.Time{}, ErrNoSecret
	}
	expires, sig := query.Get("expires"), query.Get("sig")
	if expires == "" || sig == "" {
		return time.Time{}, ErrMissing
	}
	unix, err := strconv.ParseInt(expires, 10, 64)
	if err != nil {
		return time.Time{}, ErrBadExpires
	}
	expiresAt := time.Unix(unix, 0)
	if now.Unix() > unix {
		return expiresAt, ErrExpired
	}
	if !hmac.Equal([]byte(strings.ToLower(sig)), []byte(Sign(secret, path, expires))) {
		return expiresAt, ErrBadSignature
	}
	return expiresAt, nil
}

// Strip removes every signing parameter from rawQuery, leaving the others in
// their original order and encoding, so every signed URL for one object
// shares a single cache key and the origin never sees the signature.
func Strip(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	parts := strings.Split(rawQuery, "&")
	kept := parts[:0]
	for _, part := range parts {
		if part == "" {
			continue
		}
		name := part
		if i := strings.IndexByte(part, '='); i != -1 {
			name = part[:i]
		}
		if decoded, err := url.QueryUnescape(name); err == nil {
			name = decoded
		}
		if isParam(name) {
			continue
		}
		kept = append(kept, part)
	}
	return strings.Join(kept, "&")
}

func isParam(name string) bool {
	for _, p := range Params {
		if name == p {
			return true
		}
	}
	return false
}

// ContentDisposition builds the header for the optional download=1 and
// filename= modifiers (EDD Section 5.5). They sit outside the signed message
// because they only shape a response the signature already authorized.
func ContentDisposition(query url.Values) (string, bool) {
	download := query.Get("download") == "1"
	filename := sanitizeFilename(query.Get("filename"))
	if !download && filename == "" {
		return "", false
	}
	disposition := "inline"
	if download {
		disposition = "attachment"
	}
	if filename == "" {
		return disposition, true
	}
	return disposition + `; filename="` + asciiFallback(filename) + `"; filename*=UTF-8''` + encodeRFC5987(filename), true
}

// sanitizeFilename drops the characters that could break out of the quoted
// header value or inject a new header line.
func sanitizeFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

func asciiFallback(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r > 0x7e {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// encodeRFC5987 percent-encodes every byte outside RFC 5987's attr-char set.
func encodeRFC5987(name string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(name); i++ {
		c := name[i]
		if isAttrChar(c) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hexDigits[c>>4])
		b.WriteByte(hexDigits[c&0x0f])
	}
	return b.String()
}

func isAttrChar(c byte) bool {
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		return true
	}
	return strings.IndexByte("!#$&+-.^_`|~", c) != -1
}

// CapCacheControl rewrites a response's Cache-Control so nothing downstream
// of the edge keeps serving the object after its signed URL expires: shared
// caches are cut out (public and s-maxage dropped, private added) and
// max-age is capped at the time left on the signature. A no-store response
// already caches nothing and is returned unchanged.
func CapCacheControl(value string, remaining time.Duration) string {
	limit := int64(remaining / time.Second)
	if limit < 0 {
		limit = 0
	}
	maxAge := limit
	var others []string
	for _, raw := range strings.Split(value, ",") {
		directive := strings.TrimSpace(raw)
		if directive == "" {
			continue
		}
		name, arg := strings.ToLower(directive), ""
		if i := strings.IndexByte(directive, '='); i != -1 {
			name, arg = strings.ToLower(strings.TrimSpace(directive[:i])), strings.Trim(strings.TrimSpace(directive[i+1:]), `"`)
		}
		switch name {
		case "no-store":
			return value
		case "public", "private", "s-maxage":
			continue
		case "max-age":
			if v, err := strconv.ParseInt(arg, 10, 64); err == nil && v < maxAge {
				maxAge = v
			}
			continue
		}
		others = append(others, directive)
	}
	return strings.Join(append([]string{"private", "max-age=" + strconv.FormatInt(maxAge, 10)}, others...), ", ")
}
