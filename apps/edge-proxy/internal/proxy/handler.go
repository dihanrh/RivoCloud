package proxy

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
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

	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery)
	now := h.now()

	entry, hitLayerIdx, found := h.lookup(r.Context(), key)
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "HIT")
		return
	}

	etag := ""
	if found {
		etag = entry.ETag
	}
	result, err := h.fetchOrigin(r, z, etag)
	if err != nil {
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "STALE")
			return
		}
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}

	if result.notModified {
		refreshed := refreshExpiry(entry, result.decision, now)
		h.store(r.Context(), key, refreshed)
		writeEntry(w, r, h.negotiateEncoding(r, key, refreshed), now, "HIT")
		return
	}

	defer result.response.Body.Close()
	body, err := io.ReadAll(result.response.Body)
	if err != nil {
		http.Error(w, "error reading origin response", http.StatusBadGateway)
		return
	}
	newEntry := buildEntry(result.response, body, result.decision, now)
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, h.negotiateEncoding(r, key, newEntry), now, "MISS")
}

func (h *CachingHandler) proxyUncached(w http.ResponseWriter, r *http.Request, z zone.Config) {
	result, err := h.fetchOrigin(r, z, "")
	if err != nil {
		http.Error(w, "origin unreachable", http.StatusBadGateway)
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

func (h *CachingHandler) fetchOrigin(r *http.Request, z zone.Config, etag string) (*originResult, error) {
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
	// With no Accept-Encoding header at all, Go's http.Transport adds its
	// own "Accept-Encoding: gzip" and transparently decompresses the
	// response (stripping Content-Encoding/Content-Length before we ever
	// see them) — forwarding the client's own header verbatim disables
	// that and risks caching an already-compressed body as "identity".
	outReq.Header.Del("Accept-Encoding")
	if etag != "" {
		outReq.Header.Set("If-None-Match", etag)
	}

	resp, err := h.Origin.Do(outReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotModified {
		decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
		resp.Body.Close()
		return &originResult{notModified: true, decision: decision}, nil
	}

	decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
	return &originResult{response: resp, decision: decision}, nil
}

func (h *CachingHandler) lookup(ctx context.Context, key string) (cachestore.Entry, int, bool) {
	for i, layer := range h.Layers {
		if layer == nil {
			continue
		}
		entry, ok, err := layer.Get(ctx, key)
		if err != nil {
			log.Printf("cache layer %d get error: %v", i, err)
			continue
		}
		if ok {
			return entry, i, true
		}
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

func buildEntry(resp *http.Response, body []byte, decision httpcache.Decision, now time.Time) cachestore.Entry {
	header := resp.Header.Clone()
	header.Del("Cache-Control")
	header.Del("Expires")
	header.Del("ETag")
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
	}
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
	w.Header().Set("Cache-Control", httpcache.BrowserCacheControl(httpcache.Decision{Cacheable: entry.Cacheable}, remaining))
	w.Header().Set("Vary", "Accept-Encoding")
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
	if cached, _, ok := h.lookup(ctx, gzKey); ok && cached.Fresh(h.now()) {
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
