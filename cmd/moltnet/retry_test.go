package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetryTransport_NoRetryOnSuccess(t *testing.T) {
	// Arrange
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	client := &http.Client{
		Transport: NewRetryTransport(nil, nil),
	}

	// Act
	resp, err := client.Get(srv.URL)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

func TestRetryTransport_Retries429AllMethods(t *testing.T) {
	for _, method := range []string{"GET", "POST", "PUT", "DELETE", "PATCH"} {
		t.Run(method, func(t *testing.T) {
			// Arrange
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				if n <= 2 {
					w.WriteHeader(429)
					return
				}
				w.WriteHeader(200)
			}))
			defer srv.Close()

			client := &http.Client{
				Transport: NewRetryTransport(nil, &RetryConfig{
					BaseDelay: time.Millisecond,
					MaxDelay:  10 * time.Millisecond,
					Jitter:    false,
				}),
			}

			req, _ := http.NewRequest(method, srv.URL, nil)

			// Act
			resp, err := client.Do(req)

			// Assert
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Errorf("expected 200, got %d", resp.StatusCode)
			}
			if got := atomic.LoadInt32(&calls); got != 3 {
				t.Errorf("expected 3 calls, got %d", got)
			}
		})
	}
}

func TestRetryTransport_Retries5xxOnlyIdempotent(t *testing.T) {
	tests := []struct {
		method    string
		wantCalls int32
		wantCode  int
	}{
		{"GET", 3, 200},
		{"PUT", 3, 200},
		{"HEAD", 3, 200},
		{"OPTIONS", 3, 200},
		{"POST", 1, 503},
		{"PATCH", 1, 503},
		{"DELETE", 1, 503},
	}

	for _, tt := range tests {
		t.Run(tt.method, func(t *testing.T) {
			// Arrange
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				if n <= 2 {
					w.WriteHeader(503)
					return
				}
				w.WriteHeader(200)
			}))
			defer srv.Close()

			client := &http.Client{
				Transport: NewRetryTransport(nil, &RetryConfig{
					BaseDelay: time.Millisecond,
					MaxDelay:  10 * time.Millisecond,
					Jitter:    false,
				}),
			}

			req, _ := http.NewRequest(tt.method, srv.URL, nil)

			// Act
			resp, err := client.Do(req)

			// Assert
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tt.wantCode {
				t.Errorf("expected %d, got %d", tt.wantCode, resp.StatusCode)
			}
			if got := atomic.LoadInt32(&calls); got != tt.wantCalls {
				t.Errorf("expected %d calls, got %d", tt.wantCalls, got)
			}
		})
	}
}

func TestRetryTransport_ExhaustsRetries(t *testing.T) {
	// Arrange
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(429)
	}))
	defer srv.Close()

	client := &http.Client{
		Transport: NewRetryTransport(nil, &RetryConfig{
			MaxRetries: 2,
			BaseDelay:  time.Millisecond,
			MaxDelay:   10 * time.Millisecond,
			Jitter:     false,
		}),
	}

	// Act
	resp, err := client.Get(srv.URL)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Errorf("expected 429 after exhausting retries, got %d", resp.StatusCode)
	}
	// 1 initial + 2 retries = 3
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("expected 3 calls (1 + 2 retries), got %d", got)
	}
}

func TestRetryTransport_HonorsRetryAfterSeconds(t *testing.T) {
	// Arrange
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.Header().Set("Retry-After", "0") // 0 seconds
			w.WriteHeader(429)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	client := &http.Client{
		Transport: NewRetryTransport(nil, &RetryConfig{
			BaseDelay: time.Hour, // Would be very slow without Retry-After
			MaxDelay:  time.Hour,
			Jitter:    false,
		}),
	}

	// Act
	start := time.Now()
	resp, err := client.Get(srv.URL)
	elapsed := time.Since(start)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	// Should be fast because Retry-After: 0
	if elapsed > 5*time.Second {
		t.Errorf("expected fast retry with Retry-After:0, took %v", elapsed)
	}
}

func TestRetryTransport_ExponentialBackoff(t *testing.T) {
	// Arrange
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n <= 3 {
			w.WriteHeader(429)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	var delays []time.Duration
	client := &http.Client{
		Transport: NewRetryTransport(nil, &RetryConfig{
			BaseDelay: 10 * time.Millisecond,
			MaxDelay:  time.Second,
			Jitter:    false,
			OnRetry: func(attempt int, delay time.Duration, reason string) {
				delays = append(delays, delay)
			},
		}),
	}

	// Act
	resp, err := client.Get(srv.URL)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if len(delays) != 3 {
		t.Fatalf("expected 3 retries, got %d", len(delays))
	}
	// Attempt 0: 10ms * 2^0 = 10ms
	// Attempt 1: 10ms * 2^1 = 20ms
	// Attempt 2: 10ms * 2^2 = 40ms
	if delays[0] != 10*time.Millisecond {
		t.Errorf("delay[0] = %v, want 10ms", delays[0])
	}
	if delays[1] != 20*time.Millisecond {
		t.Errorf("delay[1] = %v, want 20ms", delays[1])
	}
	if delays[2] != 40*time.Millisecond {
		t.Errorf("delay[2] = %v, want 40ms", delays[2])
	}
}

func TestRetryTransport_MaxDelayCap(t *testing.T) {
	// Arrange
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n <= 1 {
			w.WriteHeader(429)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	var delays []time.Duration
	client := &http.Client{
		Transport: NewRetryTransport(nil, &RetryConfig{
			BaseDelay: time.Second,
			MaxDelay:  50 * time.Millisecond, // Cap well below baseDelay
			Jitter:    false,
			OnRetry: func(attempt int, delay time.Duration, reason string) {
				delays = append(delays, delay)
			},
		}),
	}

	// Act
	resp, err := client.Get(srv.URL)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if len(delays) != 1 {
		t.Fatalf("expected 1 retry, got %d", len(delays))
	}
	if delays[0] != 50*time.Millisecond {
		t.Errorf("delay[0] = %v, want 50ms (capped)", delays[0])
	}
}

func TestRetryTransport_DoesNotRetry4xx(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 409, 422} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			// Arrange
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				w.WriteHeader(status)
			}))
			defer srv.Close()

			client := &http.Client{
				Transport: NewRetryTransport(nil, &RetryConfig{
					BaseDelay: time.Millisecond,
					Jitter:    false,
				}),
			}

			// Act
			resp, err := client.Get(srv.URL)

			// Assert
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != status {
				t.Errorf("expected %d, got %d", status, resp.StatusCode)
			}
			if got := atomic.LoadInt32(&calls); got != 1 {
				t.Errorf("expected 1 call (no retry), got %d", got)
			}
		})
	}
}

func TestRetryTransport_DefaultConfig(t *testing.T) {
	// Arrange — nil config should use defaults
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.WriteHeader(429)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	client := &http.Client{
		Transport: NewRetryTransport(nil, nil),
	}

	// Act
	resp, err := client.Get(srv.URL)

	// Assert
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("expected 2 calls, got %d", got)
	}
}
