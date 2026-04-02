package main

import (
	"context"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

// retryStatuses are HTTP status codes eligible for retry.
// 429 retries all methods (request never processed by server).
// 408/500/502/503/504 only retry idempotent methods.
var retryStatuses = map[int]bool{
	408: true,
	429: true,
	500: true,
	502: true,
	503: true,
	504: true,
}

var idempotentMethods = map[string]bool{
	"GET":     true,
	"HEAD":    true,
	"OPTIONS": true,
	"PUT":     true,
}

// RetryConfig controls retry behavior. All fields have sensible defaults.
type RetryConfig struct {
	MaxRetries int
	BaseDelay  time.Duration
	MaxDelay   time.Duration
	Jitter     bool
	OnRetry    func(attempt int, delay time.Duration, reason string)
}

func (c *RetryConfig) maxRetries() int {
	if c == nil || c.MaxRetries <= 0 {
		return 3
	}
	return c.MaxRetries
}

func (c *RetryConfig) baseDelay() time.Duration {
	if c == nil || c.BaseDelay == 0 {
		return 500 * time.Millisecond
	}
	return c.BaseDelay
}

func (c *RetryConfig) maxDelay() time.Duration {
	if c == nil || c.MaxDelay == 0 {
		return 10 * time.Second
	}
	return c.MaxDelay
}

func (c *RetryConfig) jitter() bool {
	if c == nil {
		return true
	}
	return c.Jitter
}

func (c *RetryConfig) onRetry(attempt int, delay time.Duration, reason string) {
	if c != nil && c.OnRetry != nil {
		c.OnRetry(attempt, delay, reason)
	}
}

// retryTransport wraps an http.RoundTripper with retry logic for transient failures.
type retryTransport struct {
	base http.RoundTripper
	cfg  *RetryConfig
}

// NewRetryTransport creates an http.RoundTripper that retries on 429 (all methods)
// and 408/5xx (idempotent methods only) with exponential backoff and Retry-After support.
// Pass nil for base to use http.DefaultTransport. Pass nil for cfg for defaults.
func NewRetryTransport(base http.RoundTripper, cfg *RetryConfig) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &retryTransport{base: base, cfg: cfg}
}

func (t *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	maxRetries := t.cfg.maxRetries()

	// If the request has a body but no GetBody, we can't replay it.
	// Only attempt the first request; skip retries for non-idempotent methods.
	canReplay := req.Body == nil || req.GetBody != nil

	for attempt := 0; attempt <= maxRetries; attempt++ {
		// Clone the request to get a fresh body for each attempt.
		attemptReq := req
		if attempt > 0 && req.GetBody != nil {
			body, err := req.GetBody()
			if err != nil {
				return nil, fmt.Errorf("retry: reset request body: %w", err)
			}
			attemptReq = req.Clone(req.Context())
			attemptReq.Body = body
		}

		resp, err := t.base.RoundTrip(attemptReq)
		if err != nil {
			return nil, err
		}

		if !retryStatuses[resp.StatusCode] || attempt == maxRetries {
			return resp, nil
		}

		isRateLimited := resp.StatusCode == 429
		if !isRateLimited && !idempotentMethods[req.Method] {
			return resp, nil
		}

		// Non-idempotent methods with non-replayable bodies: return as-is.
		if !canReplay && !idempotentMethods[req.Method] {
			return resp, nil
		}

		// Drain and close body to allow TCP connection reuse.
		io.Copy(io.Discard, resp.Body) //nolint:errcheck
		resp.Body.Close()

		delay := computeRetryDelay(attempt, t.cfg.baseDelay(), t.cfg.maxDelay(), t.cfg.jitter(), resp)
		t.cfg.onRetry(attempt, delay, "status "+strconv.Itoa(resp.StatusCode))

		if err := retrySleep(req.Context(), delay); err != nil {
			return nil, err
		}
	}

	// Unreachable: the loop always returns on attempt == maxRetries.
	return nil, fmt.Errorf("retry: unreachable")
}

// retrySleep waits for the given duration or until the context is cancelled.
func retrySleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func computeRetryDelay(attempt int, baseDelay, maxDelay time.Duration, jitter bool, resp *http.Response) time.Duration {
	if retryAfter := resp.Header.Get("Retry-After"); retryAfter != "" {
		if seconds, err := strconv.ParseFloat(retryAfter, 64); err == nil {
			d := time.Duration(seconds * float64(time.Second))
			if d > maxDelay {
				return maxDelay
			}
			return d
		}
		if date, err := time.Parse(time.RFC1123, retryAfter); err == nil {
			d := time.Until(date)
			if d < 0 {
				d = 0
			}
			if d > maxDelay {
				return maxDelay
			}
			return d
		}
	}

	exponential := float64(baseDelay) * math.Pow(2, float64(attempt))
	d := time.Duration(exponential)
	if jitter {
		d += time.Duration(rand.Int64N(int64(baseDelay)))
	}
	if d > maxDelay {
		return maxDelay
	}
	return d
}
