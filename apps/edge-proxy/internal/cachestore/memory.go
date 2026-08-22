package cachestore

import (
	"context"

	lru "github.com/hashicorp/golang-lru/v2"
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
