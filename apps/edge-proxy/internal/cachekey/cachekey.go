package cachekey

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strings"
)

// Build constructs the canonical cache key for a request, per the EDD's
// cache-key design (Section 5.2): zone + method + normalized host/path/query,
// hashed with SHA-256. queryMode/queryWhitelist implement the per-rule
// query-string normalization from cache_rules (EDD Section 6.2): "strip_all"
// drops every query param, "whitelist" keeps only queryWhitelist's keys,
// "include_all" (also the fallback for "" or an unrecognized mode, matching
// pre-Stage-7 behavior) sorts and keeps every param.
func Build(zoneID, method, host, path, rawQuery, queryMode string, queryWhitelist []string) string {
	h := sha256.New()
	h.Write([]byte(zoneID))
	h.Write([]byte{'|'})
	h.Write([]byte(strings.ToUpper(method)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeHost(host)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizePath(path)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeQuery(rawQuery, queryMode, queryWhitelist)))
	return hex.EncodeToString(h.Sum(nil))
}

// NormalizeMethod folds HEAD into GET for cache-key purposes (HEAD shares
// GET's cache entry, RFC 7231 §4.3.2); every other method passes through.
func NormalizeMethod(method string) string {
	if strings.EqualFold(method, "HEAD") {
		return "GET"
	}
	return method
}

func normalizeHost(host string) string {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i != -1 {
		host = host[:i]
	}
	return host
}

func normalizePath(path string) string {
	path = strings.ToLower(path)
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	return path
}

func normalizeQuery(rawQuery, queryMode string, whitelist []string) string {
	if queryMode == "strip_all" {
		return ""
	}
	if rawQuery == "" {
		return ""
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return rawQuery
	}
	if queryMode == "whitelist" {
		allowed := make(map[string]bool, len(whitelist))
		for _, k := range whitelist {
			allowed[k] = true
		}
		for k := range values {
			if !allowed[k] {
				delete(values, k)
			}
		}
	}
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Emit each pair RE-ESCAPED, never the decoded Go string. Writing back
	// decoded values would collapse "?a=b%26c%3Dd" (one param whose value is
	// literally "b&c=d") onto "?a=b&c=d" (two params) — the origin still
	// receives the raw query and returns different content for each, so a
	// shared key would serve one request's body for the other's. Because
	// url.QueryEscape never emits a bare '&' or '=', the joined form uniquely
	// determines the pairs it was built from.
	pairs := make([]string, 0, len(values))
	for _, k := range keys {
		vs := append([]string{}, values[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			pairs = append(pairs, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(pairs, "&")
}
