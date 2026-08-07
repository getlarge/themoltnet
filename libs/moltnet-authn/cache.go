package moltnetauthn

import (
	"container/list"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"sync"
	"time"
)

type cacheEntry struct {
	key       string
	principal Principal
	expiresAt time.Time
	tag       string
}

type flight struct {
	done        chan struct{}
	principal   Principal
	err         error
	invalidated map[string]struct{}
}

type authCache struct {
	mu       sync.Mutex
	entries  map[string]*list.Element
	lru      *list.List
	flights  map[string]*flight
	tags     map[string]map[string]struct{}
	max      int
	ttl      time.Duration
	hmacKey  []byte
	now      func() time.Time
	observer Observer
}

func newAuthCache(cfg Config, observer Observer) *authCache {
	return &authCache{
		entries: make(map[string]*list.Element), lru: list.New(),
		flights: make(map[string]*flight), tags: make(map[string]map[string]struct{}),
		max: cfg.CacheMaxEntries, ttl: cfg.CacheTTL, hmacKey: append([]byte(nil), cfg.HMACKey...),
		now: cfg.Now, observer: observer,
	}
}

func (c *authCache) digest(parts ...string) string {
	h := hmac.New(sha256.New, c.hmacKey)
	for _, part := range parts {
		h.Write([]byte(strconv.Itoa(len(part))))
		h.Write([]byte{':'})
		h.Write([]byte(part))
		h.Write([]byte{'|'})
	}
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func clonePrincipal(p Principal) Principal {
	p.Scopes = append([]string(nil), p.Scopes...)
	return p
}

func (c *authCache) resolve(ctx context.Context, kind, issuer, credential string, load func() (Principal, string, error)) (Principal, error) {
	key := c.digest(kind, issuer, credential)
	for {
		c.mu.Lock()
		if elem := c.entries[key]; elem != nil {
			entry := elem.Value.(*cacheEntry)
			if c.now().Before(entry.expiresAt) {
				c.lru.MoveToBack(elem)
				p := clonePrincipal(entry.principal)
				c.mu.Unlock()
				c.observer.CacheAccess(ctx, kind, "hit")
				return p, nil
			}
			c.removeLocked(elem, "expired", ctx)
		}
		if current := c.flights[key]; current != nil {
			c.mu.Unlock()
			c.observer.CacheAccess(ctx, kind, "single_flight")
			select {
			case <-ctx.Done():
				return Principal{}, ctx.Err()
			case <-current.done:
				if current.err != nil {
					return Principal{}, current.err
				}
				if current.principal.IdentityID == "" {
					continue
				}
				return clonePrincipal(current.principal), nil
			}
		}
		current := &flight{done: make(chan struct{}), invalidated: make(map[string]struct{})}
		c.flights[key] = current
		c.mu.Unlock()
		c.observer.CacheAccess(ctx, kind, "miss")

		principal, tag, err := load()
		c.mu.Lock()
		if err == nil {
			if _, invalidated := current.invalidated[tag]; invalidated {
				principal = Principal{}
			} else {
				expiresAt := c.now().Add(c.ttl)
				if !principal.ExpiresAt.IsZero() && principal.ExpiresAt.Before(expiresAt) {
					expiresAt = principal.ExpiresAt
				}
				if c.ttl > 0 && expiresAt.After(c.now()) {
					c.insertLocked(key, principal, expiresAt, tag, ctx)
				}
			}
		}
		current.principal, current.err = clonePrincipal(principal), err
		delete(c.flights, key)
		close(current.done)
		c.mu.Unlock()
		if err != nil {
			return Principal{}, err
		}
		if principal.IdentityID == "" {
			continue
		}
		return clonePrincipal(principal), nil
	}
}

func (c *authCache) insertLocked(key string, principal Principal, expiresAt time.Time, tag string, ctx context.Context) {
	if old := c.entries[key]; old != nil {
		c.removeLocked(old, "", ctx)
	}
	entry := &cacheEntry{key: key, principal: clonePrincipal(principal), expiresAt: expiresAt, tag: tag}
	c.entries[key] = c.lru.PushBack(entry)
	if tag != "" {
		keys := c.tags[tag]
		if keys == nil {
			keys = make(map[string]struct{})
			c.tags[tag] = keys
		}
		keys[key] = struct{}{}
	}
	for c.lru.Len() > c.max {
		c.removeLocked(c.lru.Front(), "capacity", ctx)
	}
}

func (c *authCache) removeLocked(elem *list.Element, reason string, ctx context.Context) {
	entry := elem.Value.(*cacheEntry)
	delete(c.entries, entry.key)
	c.lru.Remove(elem)
	if entry.tag != "" {
		delete(c.tags[entry.tag], entry.key)
		if len(c.tags[entry.tag]) == 0 {
			delete(c.tags, entry.tag)
		}
	}
	if reason != "" {
		c.observer.CacheEviction(ctx, reason)
	}
}

func (c *authCache) evictTag(tag string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, current := range c.flights {
		current.invalidated[tag] = struct{}{}
	}
	for key := range c.tags[tag] {
		if elem := c.entries[key]; elem != nil {
			c.removeLocked(elem, "tag", context.Background())
		}
	}
}

func cacheTag(kind, id string) string { return strings.Join([]string{kind, id}, ":") }
