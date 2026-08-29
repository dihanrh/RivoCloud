package proxy

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
	"rivocloud/edge-proxy/internal/cacherules"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/compress"
	"rivocloud/edge-proxy/internal/httpcache"
	"rivocloud/edge-proxy/internal/zone"
)

// OriginFetcher is satisfied directly by *http.Client; tests inject a
// client whose Transport can simulate origin failures.
type OriginFetcher interface {
	Do(req *http.Request) (*http.Response, error)
}

// CachingHandler implements the Edge Proxy's entire request pipeline (EDD
// Section 2.1): resolve a zone, build a cache key, check Layers
// fastest-to-slowest, forward to origin on a miss, apply Cache-Control/ETag
// rules, populate Layers. The SAME handler backs every Stage 3 sub-step:
// with Layers empty (this task) it behaves as bare forwarding (3.1); Task 6
// sets Layers to Redis only (3.2); Task 8 prepends an in-process LRU (3.3).
type CachingHandler struct {
	Zones  zone.Registry
	Layers []cachestore.Layer // checked in order; index 0 is fastest
	Origin OriginFetcher
	Now    func() time.Time
}

func (h *CachingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z, ok := h.Zones.Resolve(r.Host)
	if !ok {
		http.Error(w, "unknown zone", http.StatusNotFound)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.proxyUncached(w, r, z)
		return
	}

	// A Range request bypasses the cache in both directions. The cache key
	// carries no range, so serving a stored full body would answer the wrong
	// bytes and storing a 206 would poison the full-body entry.
	if r.Header.Get("Range") != "" {
		h.proxyUncached(w, r, z)
		return
	}

	rule, ruleMatched := cacherules.Match(z.Rules, r.URL.Path)
	// A bypass/no-store rule (EDD Section 5.3, Priority 1) means "never
	// cache this," which is exactly what the uncached passthrough path
	// already does — no separate non-caching branch needed.
	if ruleMatched && (rule.Action == "bypass" || rule.Action == "no-store") {
		h.proxyUncached(w, r, z)
		return
	}

	queryMode, queryWhitelist := "include_all", []string(nil)
	if ruleMatched {
		queryMode, queryWhitelist = rule.QueryString, rule.QueryWhitelist
	}
	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery, queryMode, queryWhitelist)
	now := h.now()

	entry, hitLayerIdx, found := h.lookup(r.Context(), key, now)
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "HIT")
		return
	}

	etag := ""
	if found {
		etag = entry.ETag
	}
	var ruleTTLOverride *time.Duration
	var ruleBrowserTTLOverride *time.Duration
	if ruleMatched && rule.EdgeTTL != nil {
		d := time.Duration(*rule.EdgeTTL) * time.Second
		ruleTTLOverride = &d
	}
	if ruleMatched && rule.BrowserTTL != nil {
		d := time.Duration(*rule.BrowserTTL) * time.Second
		ruleBrowserTTLOverride = &d
	}
	result, err := h.fetchOrigin(r, z, originRequest{
		method:           http.MethodGet,
		ifNoneMatch:      etag,
		ownsRevalidation: true,
		ttlOverride:      ruleTTLOverride,
	})
	if err != nil {
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "STALE")
			return
		}
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}

	if result.notModified {
		if !found {
			// Unreachable once the client's own conditional headers are
			// stripped above: the edge only sends If-None-Match when it has
			// something to revalidate. Refreshing/serving the zero-valued
			// entry here would emit WriteHeader(0) and panic, so fail loudly
			// instead.
			log.Printf("origin returned 304 with nothing cached for key %s", key)
			http.Error(w, "unexpected origin 304", http.StatusBadGateway)
			return
		}
		refreshed := refreshExpiry(entry, result.decision, now)
		refreshed.BrowserTTL = ruleBrowserTTLOverride
		if result.decision.Cacheable {
			h.store(r.Context(), key, refreshed)
		}
		writeEntry(w, r, h.negotiateEncoding(r, key, refreshed), now, "HIT")
		return
	}

	defer result.response.Body.Close()
	body, err := io.ReadAll(result.response.Body)
	if err != nil {
		http.Error(w, "error reading origin response", http.StatusBadGateway)
		return
	}
	newEntry := buildEntry(result.response, body, result.decision, now, z.ID, r.URL.Path)
	newEntry.BrowserTTL = ruleBrowserTTLOverride
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, h.negotiateEncoding(r, key, newEntry), now, "MISS")
}

func (h *CachingHandler) proxyUncached(w http.ResponseWriter, r *http.Request, z zone.Config) {
	result, err := h.fetchOrigin(r, z, originRequest{})
	if err != nil {
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}
	if result.notModified {
		// fetchOrigin closes and discards the body of a 304, leaving
		// result.response nil — a 304 carries no body anyway, so relay the
		// bare status before touching it.
		w.WriteHeader(http.StatusNotModified)
		return
	}
	defer result.response.Body.Close()
	for k, vs := range result.response.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(result.response.StatusCode)
	io.Copy(w, result.response.Body)
}

type originResult struct {
	response    *http.Response
	notModified bool
	decision    httpcache.Decision
}

// conditionalRequestHeaders are the client's own precondition headers. On the
// caching path they must never reach the origin: the edge, not the client,
// owns revalidation there, and a client-triggered 304 would leave the handler
// with no representation to serve (RFC 9111 §4.3.1).
var conditionalRequestHeaders = []string{
	"If-None-Match",
	"If-Modified-Since",
	"If-Match",
	"If-Unmodified-Since",
	"If-Range",
}

// originRequest describes how the edge should talk to the origin for one
// client request.
type originRequest struct {
	// method overrides the client's method for the origin request; empty
	// means "use the client's". The caching path always sets GET: HEAD folds
	// onto GET's cache key (cachekey.NormalizeMethod), and HTTP forbids a
	// body on a HEAD response, so fetching with HEAD would store the shared
	// entry with an empty body. writeEntry still omits the body when the
	// CLIENT asked for HEAD.
	method string
	// ifNoneMatch is the edge's OWN cached ETag, empty when it has none.
	ifNoneMatch string
	// ownsRevalidation is true on the caching path, where the edge issues
	// its own conditional request and so must strip the client's. It stays
	// false on the uncached passthrough path, where the client's
	// preconditions are part of the semantics being proxied (an If-Match on
	// a PUT, an If-Range on a Range request) and stripping them would be a
	// correctness bug in its own right.
	ownsRevalidation bool
	// ttlOverride, when set (a matched cache rule's edgeTtl), replaces
	// Decide's origin-header-derived TTL outright — EDD Section 5.3,
	// Priority 1: a cache rule is not a clamp on the origin's own
	// Cache-Control, it supersedes it entirely.
	ttlOverride *time.Duration
}

func (h *CachingHandler) fetchOrigin(r *http.Request, z zone.Config, spec originRequest) (*originResult, error) {
	target, err := url.Parse(z.OriginURL)
	if err != nil {
		return nil, err
	}

	outReq := r.Clone(r.Context())
	outReq.URL.Scheme = target.Scheme
	outReq.URL.Host = target.Host
	outReq.URL.Path = r.URL.Path
	outReq.Host = target.Host
	outReq.RequestURI = ""
	if spec.method != "" {
		outReq.Method = spec.method
	}
	stripHopByHopHeaders(outReq.Header)
	appendForwardedFor(outReq.Header, r.RemoteAddr)
	if spec.ownsRevalidation {
		for _, name := range conditionalRequestHeaders {
			outReq.Header.Del(name)
		}
	}
	// With no Accept-Encoding header at all, Go's http.Transport adds its
	// own "Accept-Encoding: gzip" and transparently decompresses the
	// response (stripping Content-Encoding/Content-Length before we ever
	// see them) — forwarding the client's own header verbatim disables
	// that and risks caching an already-compressed body as "identity".
	outReq.Header.Del("Accept-Encoding")
	if spec.ifNoneMatch != "" {
		outReq.Header.Set("If-None-Match", spec.ifNoneMatch)
	}

	resp, err := h.Origin.Do(outReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotModified {
		decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
		applyTTLOverride(&decision, spec.ttlOverride)
		resp.Body.Close()
		return &originResult{notModified: true, decision: decision}, nil
	}

	decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
	applyTTLOverride(&decision, spec.ttlOverride)
	// Decide only reads freshness directives. Storable applies the gates that
	// no Cache-Control can override — status code, an unhonorable Vary, and
	// an authenticated request without an explicit "public". Zeroing the
	// whole Decision (rather than only its Cacheable flag) also makes
	// writeEntry advertise no-store to the client.
	if decision.Cacheable && !httpcache.Storable(resp.StatusCode, resp.Header, r.Header.Get("Authorization") != "") {
		decision = httpcache.Decision{Cacheable: false}
	}
	return &originResult{response: resp, decision: decision}, nil
}

// applyTTLOverride replaces decision's TTL with override when a cache rule
// matched, leaving StaleIfErrorTTL (not part of any cache_rules field) and
// Cacheable untouched.
func applyTTLOverride(decision *httpcache.Decision, override *time.Duration) {
	if override == nil {
		return
	}
	decision.Cacheable = true
	decision.TTL = *override
	decision.MustRevalidate = false
}

// lookup scans the layers fastest-to-slowest and returns the first FRESH copy
// it finds, not merely the first copy. Stopping at a stale faster layer would
// make every replica whose L1 holds an expired object re-fetch from the origin
// even when the shared L2 already has a fresh one — which is the whole point
// of having an L2. Stale copies passed over on the way are still remembered
// (the most-recently-expired one wins) so revalidation-with-ETag and
// stale-if-error have something to work with when no layer is fresh.
// hopByHopHeaders are scoped to a single connection and must never cross a
// proxy boundary (RFC 7230 §6.1). Note Proxy-Authorization is hop-scoped
// while plain Authorization is end-to-end and is deliberately forwarded.
var hopByHopHeaders = []string{
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
}

func stripHopByHopHeaders(header http.Header) {
	// Connection also NOMINATES further field names as hop-scoped, so read it
	// before deleting it.
	for _, nominated := range header.Values("Connection") {
		for _, name := range strings.Split(nominated, ",") {
			if name = strings.TrimSpace(name); name != "" {
				header.Del(name)
			}
		}
	}
	for _, name := range hopByHopHeaders {
		header.Del(name)
	}
}

// appendForwardedFor adds the immediate client's IP to the X-Forwarded-For
// chain, preserving any hops recorded upstream of this edge.
func appendForwardedFor(header http.Header, remoteAddr string) {
	ip, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		ip = remoteAddr // no port (or unparseable); use it as-is
	}
	if ip == "" {
		return
	}
	if prior := header.Get("X-Forwarded-For"); prior != "" {
		header.Set("X-Forwarded-For", prior+", "+ip)
		return
	}
	header.Set("X-Forwarded-For", ip)
}

func (h *CachingHandler) lookup(ctx context.Context, key string, now time.Time) (cachestore.Entry, int, bool) {
	var (
		bestStale    cachestore.Entry
		bestStaleIdx = -1
	)
	for i, layer := range h.Layers {
		if layer == nil {
			continue
		}
		entry, ok, err := layer.Get(ctx, key)
		if err != nil {
			log.Printf("cache layer %d get error: %v", i, err)
			continue
		}
		if !ok {
			continue
		}
		if entry.Fresh(now) {
			return entry, i, true
		}
		if bestStaleIdx == -1 || entry.ExpiresAt.After(bestStale.ExpiresAt) {
			bestStale, bestStaleIdx = entry, i
		}
	}
	if bestStaleIdx != -1 {
		return bestStale, bestStaleIdx, true
	}
	return cachestore.Entry{}, -1, false
}

func (h *CachingHandler) populateFasterLayers(ctx context.Context, key string, entry cachestore.Entry, hitLayerIdx int) {
	for i := 0; i < hitLayerIdx; i++ {
		if h.Layers[i] == nil {
			continue
		}
		if err := h.Layers[i].Set(ctx, key, entry); err != nil {
			log.Printf("cache layer %d set error: %v", i, err)
		}
	}
}

func (h *CachingHandler) store(ctx context.Context, key string, entry cachestore.Entry) {
	for i, layer := range h.Layers {
		if layer == nil {
			continue
		}
		if err := layer.Set(ctx, key, entry); err != nil {
			log.Printf("cache layer %d set error: %v", i, err)
		}
	}
}

func (h *CachingHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func buildEntry(resp *http.Response, body []byte, decision httpcache.Decision, now time.Time, zoneID, path string) cachestore.Entry {
	header := resp.Header.Clone()
	tags := parseCacheTag(header.Get("Cache-Tag"))
	header.Del("Cache-Control")
	header.Del("Expires")
	header.Del("ETag")
	header.Del("Cache-Tag")
	header.Del("Content-Length")
	header.Del("Connection")
	header.Del("Transfer-Encoding")
	header.Del("Set-Cookie")
	header.Set("Content-Length", strconv.Itoa(len(body)))

	return cachestore.Entry{
		StatusCode: resp.StatusCode,
		Header:     header,
		Body:       body,
		ETag:       resp.Header.Get("ETag"),
		Cacheable:  decision.Cacheable,
		StoredAt:   now,
		ExpiresAt:  now.Add(decision.TTL),
		StaleUntil: now.Add(decision.TTL).Add(decision.StaleIfErrorTTL),
		ZoneID:     zoneID,
		Path:       path,
		Tags:       tags,
	}
}

// parseCacheTag reads the Cache-Tag origin response header (a small,
// deliberately minimal tagging convention — see the plan's Design Decisions
// #1) into a clean tag list.
func parseCacheTag(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	tags := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			tags = append(tags, trimmed)
		}
	}
	return tags
}

func refreshExpiry(entry cachestore.Entry, decision httpcache.Decision, now time.Time) cachestore.Entry {
	entry.StoredAt = now
	entry.ExpiresAt = now.Add(decision.TTL)
	entry.StaleUntil = now.Add(decision.TTL).Add(decision.StaleIfErrorTTL)
	return entry
}

func writeEntry(w http.ResponseWriter, r *http.Request, entry cachestore.Entry, now time.Time, source string) {
	for k, vs := range entry.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	remaining := entry.ExpiresAt.Sub(now)
	if entry.BrowserTTL != nil {
		remaining = *entry.BrowserTTL
	}
	w.Header().Set("Cache-Control", httpcache.BrowserCacheControl(httpcache.Decision{Cacheable: entry.Cacheable}, remaining))
	// Announce the edge's own encoding negotiation, but never at the cost of
	// the origin's Vary: a response varying by anything else is relayed with
	// that Vary intact (and is non-cacheable, per httpcache.Storable), so
	// downstream caches don't inherit a claim the origin never made.
	if httpcache.VaryOnlyAcceptEncoding(strings.Join(entry.Header.Values("Vary"), ",")) {
		w.Header().Set("Vary", "Accept-Encoding")
	}
	w.Header().Set("X-RivoCloud-Cache", source)
	if entry.ETag != "" {
		w.Header().Set("ETag", entry.ETag)
	}
	w.WriteHeader(entry.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	w.Write(entry.Body)
}

func (h *CachingHandler) negotiateEncoding(r *http.Request, baseKey string, identity cachestore.Entry) cachestore.Entry {
	if !identity.Cacheable {
		return identity
	}
	if !compress.AcceptsGzip(r.Header.Get("Accept-Encoding")) {
		return identity
	}
	if !compress.IsCompressible(identity.Header.Get("Content-Type")) {
		return identity
	}
	return h.gzipVariant(r.Context(), baseKey, identity)
}

func (h *CachingHandler) gzipVariant(ctx context.Context, baseKey string, identity cachestore.Entry) cachestore.Entry {
	gzKey := baseKey + ":gz"
	now := h.now()
	if cached, _, ok := h.lookup(ctx, gzKey, now); ok && cached.Fresh(now) {
		return cached
	}

	compressed, err := compress.Gzip(identity.Body)
	if err != nil {
		log.Printf("gzip compress error: %v", err)
		return identity
	}

	variant := identity
	variant.Header = identity.Header.Clone()
	variant.Header.Set("Content-Encoding", "gzip")
	variant.Header.Set("Content-Length", strconv.Itoa(len(compressed)))
	variant.Body = compressed

	h.store(ctx, gzKey, variant)
	return variant
}
