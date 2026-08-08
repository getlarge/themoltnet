package moltnetauthextension

import (
	"container/list"
	"sync"
	"time"
)

type tokenBucket struct {
	tokens, rate float64
	burst        float64
	last         time.Time
}

func newTokenBucket(rate float64, burst int, now time.Time) *tokenBucket {
	return &tokenBucket{tokens: float64(burst), rate: rate, burst: float64(burst), last: now}
}
func (b *tokenBucket) allow(now time.Time) bool {
	b.tokens += now.Sub(b.last).Seconds() * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type agentLimit struct {
	identity string
	bucket   *tokenBucket
	lastSeen time.Time
}
type boundedLimiter struct {
	mu              sync.Mutex
	now             func() time.Time
	global          *tokenBucket
	agentRate       float64
	agentBurst, max int
	idle            time.Duration
	agents          map[string]*list.Element
	lru             *list.List
}

func newBoundedLimiter(cfg *Config) *boundedLimiter {
	now := time.Now()
	return &boundedLimiter{now: time.Now, global: newTokenBucket(cfg.GlobalRate, cfg.GlobalBurst, now), agentRate: cfg.AgentRate, agentBurst: cfg.AgentBurst, max: cfg.LimiterMaxEntries, idle: cfg.LimiterIdleTTL, agents: make(map[string]*list.Element), lru: list.New()}
}
func (l *boundedLimiter) allowGlobal() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.global.allow(l.now())
}
func (l *boundedLimiter) allowAgent(identity string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	for elem := l.lru.Front(); elem != nil; {
		next := elem.Next()
		value := elem.Value.(*agentLimit)
		if now.Sub(value.lastSeen) > l.idle {
			delete(l.agents, value.identity)
			l.lru.Remove(elem)
		} else {
			break
		}
		elem = next
	}
	elem := l.agents[identity]
	if elem == nil {
		value := &agentLimit{identity: identity, bucket: newTokenBucket(l.agentRate, l.agentBurst, now), lastSeen: now}
		elem = l.lru.PushBack(value)
		l.agents[identity] = elem
	}
	value := elem.Value.(*agentLimit)
	value.lastSeen = now
	l.lru.MoveToBack(elem)
	for l.lru.Len() > l.max {
		oldest := l.lru.Front()
		delete(l.agents, oldest.Value.(*agentLimit).identity)
		l.lru.Remove(oldest)
	}
	return value.bucket.allow(now)
}
func (l *boundedLimiter) size() int { l.mu.Lock(); defer l.mu.Unlock(); return len(l.agents) }
