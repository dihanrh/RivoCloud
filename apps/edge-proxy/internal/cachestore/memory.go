package cachestore

import (
	"context"

	lru "github.com/hashicorp/golang-lru/v2"

	"rivocloud/edge-proxy/internal/globmatch"
)

// Memory is the L1 in-process cache: an LRU of a fixed maximum entry count,
// not shared between Edge Proxy replicas (EDD Section 2.1).
type Memory struct {
	cache *lru.Cache[string, Entry]
}

func NewMemory(maxEntries int) (*Memory, error) {
	c, err := lru.New[string, Entry](maxEntries)
	if err != nil {
		return nil, err
	}
	return &Memory{cache: c}, nil
}

func (m *Memory) Get(_ context.Context, key string) (Entry, bool, error) {
	e, ok := m.cache.Get(key)
	return e, ok, nil
}

func (m *Memory) Set(_ context.Context, key string, entry Entry) error {
	m.cache.Add(key, entry)
	return nil
}

func (m *Memory) Purge(_ context.Context, zoneID string, patterns []string, tags []string) (int, error) {
	if len(patterns) == 0 && len(tags) == 0 {
		return 0, nil
	}
	purged := 0
	for _, key := range m.cache.Keys() {
		entry, ok := m.cache.Peek(key)
		if !ok || entry.ZoneID != zoneID {
			continue
		}
		if matchesAny(entry, patterns, tags) {
			m.cache.Remove(key)
			purged++
		}
	}
	return purged, nil
}

// matchesAny is shared by every Layer's Purge: an entry matches if its Path
// glob-matches any pattern, OR it carries any of the requested tags.
func matchesAny(entry Entry, patterns []string, tags []string) bool {
	for _, pattern := range patterns {
		if globmatch.Match(pattern, entry.Path) {
			return true
		}
	}
	for _, tag := range tags {
		for _, entryTag := range entry.Tags {
			if entryTag == tag {
				return true
			}
		}
	}
	return false
}
