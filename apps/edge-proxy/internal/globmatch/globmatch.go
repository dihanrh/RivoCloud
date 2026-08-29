// Package globmatch implements the simple wildcard syntax the EDD specifies
// for cache rule patterns and invalidation patterns (Section 5.2/5.3): '*'
// matches any sequence of characters, including '/' — "/assets/*" matches
// both "/assets/app.js" and "/assets/vendor/bundle.js" (concept doc, Section
// 3.2). This is the one glob primitive shared by cache-rule matching
// (internal/cacherules) and cache purge (internal/cachestore, internal/proxy).
package globmatch

import "strings"

// Match reports whether path matches pattern. A pattern with no '*' requires
// an exact match; each '*' is a greedy wildcard matching zero or more
// characters, resolved as a sequence of literal segments that must appear in
// order.
func Match(pattern, path string) bool {
	if !strings.Contains(pattern, "*") {
		return pattern == path
	}

	segments := strings.Split(pattern, "*")

	// The first segment must be a genuine prefix (no wildcard precedes it);
	// the last must be a genuine suffix (no wildcard follows it). Segments
	// in between may appear anywhere, in order, without overlapping.
	if !strings.HasPrefix(path, segments[0]) {
		return false
	}
	path = path[len(segments[0]):]

	last := len(segments) - 1
	if !strings.HasSuffix(path, segments[last]) {
		return false
	}
	if last > 0 {
		path = path[:len(path)-len(segments[last])]
	} else {
		// A pattern like "prefix*" with no further segments: the prefix
		// check above already consumed everything meaningful.
		return true
	}

	for _, seg := range segments[1:last] {
		if seg == "" {
			continue // consecutive '*' or a '*' adjacent to another segment boundary
		}
		idx := strings.Index(path, seg)
		if idx == -1 {
			return false
		}
		path = path[idx+len(seg):]
	}
	return true
}
