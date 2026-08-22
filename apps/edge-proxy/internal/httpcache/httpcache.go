package httpcache

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultStaleIfError is applied when the origin doesn't specify its own
// stale-if-error window (EDD Section 5.3: "RivoCloud always adds
// stale-if-error: 86400 (24 hours) for cached objects unless origin
// explicitly disables it").
const DefaultStaleIfError = 24 * time.Hour

// Decision is the outcome of applying the EDD's Cache-Control priority
// hierarchy (Section 5.3), scoped to what Stage 3 implements: origin
// max-age (Priority 2), origin Expires (Priority 3), and the zone default
// TTL (Priority 4). Priority 1 (a per-path cache rule) needs Stage 7's
// cache-rules engine; Priority 5 (a content-type default) is unreachable
// here because Priority 4 always applies when the origin sends nothing.
type Decision struct {
	Cacheable       bool
	TTL             time.Duration
	StaleIfErrorTTL time.Duration
	MustRevalidate  bool
}

// Decide inspects an origin response's headers and returns whether, and for
// how long, the edge should cache it.
func Decide(header http.Header, zoneDefaultTTL time.Duration, now time.Time) Decision {
	cc := parseCacheControl(header.Get("Cache-Control"))

	if cc.noStore || cc.private {
		return Decision{Cacheable: false}
	}

	staleIfError := DefaultStaleIfError
	if cc.staleIfError >= 0 {
		staleIfError = cc.staleIfError
	}

	if cc.noCache {
		return Decision{Cacheable: true, TTL: 0, StaleIfErrorTTL: staleIfError, MustRevalidate: true}
	}

	if cc.maxAge >= 0 {
		return Decision{Cacheable: true, TTL: cc.maxAge, StaleIfErrorTTL: staleIfError}
	}

	if exp := header.Get("Expires"); exp != "" {
		if t, err := http.ParseTime(exp); err == nil {
			if ttl := t.Sub(now); ttl > 0 {
				return Decision{Cacheable: true, TTL: ttl, StaleIfErrorTTL: staleIfError}
			}
			return Decision{Cacheable: true, TTL: 0, StaleIfErrorTTL: staleIfError, MustRevalidate: true}
		}
	}

	return Decision{Cacheable: true, TTL: zoneDefaultTTL, StaleIfErrorTTL: staleIfError}
}

// storableStatusCodes is RFC 9111 §4.2.2's heuristically-cacheable set. A
// status outside it is never stored, however generous its Cache-Control:
// caching a 500 or a 302 under a plain URL key would pin an error or a
// one-shot redirect across every visitor.
var storableStatusCodes = map[int]bool{
	http.StatusOK:                   true, // 200
	http.StatusNonAuthoritativeInfo: true, // 203
	http.StatusNoContent:            true, // 204
	http.StatusMultipleChoices:      true, // 300
	http.StatusMovedPermanently:     true, // 301
	http.StatusPermanentRedirect:    true, // 308
	http.StatusNotFound:             true, // 404
	http.StatusMethodNotAllowed:     true, // 405
	http.StatusGone:                 true, // 410
	http.StatusRequestURITooLong:    true, // 414
	http.StatusNotImplemented:       true, // 501
}

// Storable reports whether a shared cache may store this response AT ALL,
// separately from how long Decide says it stays fresh. Three gates:
//
//   - the status code must be heuristically cacheable (RFC 9111 §4.2.2);
//   - the response must not Vary by anything but Accept-Encoding — the edge
//     keys only an identity and a gzip variant, so a Vary it cannot honor
//     would have it serve one client's representation to another;
//   - a response to a request carrying Authorization needs the origin to say
//     "public" explicitly, or it would be replayed to anonymous clients
//     (RFC 9111 §3.5).
func Storable(statusCode int, respHeader http.Header, requestAuthenticated bool) bool {
	if !storableStatusCodes[statusCode] {
		return false
	}
	if !VaryOnlyAcceptEncoding(respHeader.Get("Vary")) {
		return false
	}
	if requestAuthenticated && !parseCacheControl(respHeader.Get("Cache-Control")).public {
		return false
	}
	return true
}

// VaryOnlyAcceptEncoding reports whether a Vary header value names nothing
// beyond Accept-Encoding — the one dimension this edge can actually vary by.
// An absent (empty) Vary qualifies; "*" never does.
func VaryOnlyAcceptEncoding(raw string) bool {
	for _, field := range strings.Split(raw, ",") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if !strings.EqualFold(field, "Accept-Encoding") {
			return false
		}
	}
	return true
}

// BrowserCacheControl builds the Cache-Control header sent to the visitor's
// browser, independent of how long the edge itself caches the object (EDD
// Section 5.3, "Browser TTL vs Edge TTL").
func BrowserCacheControl(d Decision, remaining time.Duration) string {
	if !d.Cacheable {
		return "no-store"
	}
	if remaining < 0 {
		remaining = 0
	}
	return "public, max-age=" + strconv.Itoa(int(remaining.Seconds()))
}

type cacheControl struct {
	noStore      bool
	private      bool
	public       bool
	noCache      bool
	maxAge       time.Duration
	staleIfError time.Duration
}

func parseCacheControl(raw string) cacheControl {
	cc := cacheControl{maxAge: -1, staleIfError: -1}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		lower := strings.ToLower(part)
		switch {
		case lower == "no-store":
			cc.noStore = true
		case lower == "private":
			cc.private = true
		case lower == "public":
			cc.public = true
		case lower == "no-cache":
			cc.noCache = true
		case strings.HasPrefix(lower, "max-age="):
			if secs, err := strconv.Atoi(part[len("max-age="):]); err == nil {
				if secs < 0 {
					secs = 0
				}
				cc.maxAge = time.Duration(secs) * time.Second
			}
		case strings.HasPrefix(lower, "stale-if-error="):
			if secs, err := strconv.Atoi(part[len("stale-if-error="):]); err == nil {
				cc.staleIfError = time.Duration(secs) * time.Second
			}
		}
	}
	return cc
}
