// Package cacherules evaluates a zone's per-path cache rules (EDD Section
// 6.2 cache_rules table, concept doc Section 3): the first rule to match a
// request path — checked in priority order — decides that request's
// caching action, edge/browser TTL, and query-string normalization mode,
// overriding the origin-header-driven priority chain in internal/httpcache
// (EDD Section 5.3, Priority 1).
package cacherules

import (
	"regexp"
	"sort"

	"rivocloud/edge-proxy/internal/globmatch"
)

// Rule mirrors one row of the CDN Service's cache_rules table (field names
// match apps/cdn-service's zone_rules:{zoneId} Redis JSON exactly).
type Rule struct {
	Pattern        string
	PatternType    string // "glob" (default), "regex", "exact"
	Action         string // "cache" (default), "bypass", "no-store"
	EdgeTTL        *int   // seconds; nil = fall back to origin headers / zone default
	BrowserTTL     *int   // seconds; nil = fall back to today's edge-TTL-derived max-age
	QueryString    string // "strip_all" (default), "whitelist", "include_all"
	QueryWhitelist []string
	Priority       int
}

// SortByPriorityDesc returns a new slice ordered highest-priority-first
// (EDD: "higher = evaluated first"). The input is not mutated.
func SortByPriorityDesc(rules []Rule) []Rule {
	sorted := make([]Rule, len(rules))
	copy(sorted, rules)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Priority > sorted[j].Priority })
	return sorted
}

// Match returns the first rule (in the given order — callers pass an
// already-priority-sorted slice) whose pattern matches path, per its
// PatternType. An unparseable regex pattern never matches rather than
// panicking, so one bad rule can't take down request handling.
func Match(rules []Rule, path string) (Rule, bool) {
	for _, rule := range rules {
		if matches(rule, path) {
			return rule, true
		}
	}
	return Rule{}, false
}

func matches(rule Rule, path string) bool {
	switch rule.PatternType {
	case "exact":
		return rule.Pattern == path
	case "regex":
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			return false
		}
		return re.MatchString(path)
	default: // "glob", and anything unrecognized falls back to glob
		return globmatch.Match(rule.Pattern, path)
	}
}
