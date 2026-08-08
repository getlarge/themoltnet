package moltnetauthn

import "fmt"

// InvalidError means the credential is inactive, malformed, belongs to a
// human, or lacks required authorization. It is safe to expose to callers.
type InvalidError struct{ Reason string }

func (e *InvalidError) Error() string { return "invalid credential: " + e.Reason }

// RateLimitedError means an upstream identity provider rejected the request
// because of throttling. Provider is a bounded operation name.
type RateLimitedError struct{ Provider string }

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("authentication provider %s rate limited", e.Provider)
}

// UnavailableError means an upstream identity provider timed out or failed.
// Status is zero for transport failures.
type UnavailableError struct {
	Provider string
	Status   int
	Cause    error
}

func (e *UnavailableError) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("authentication provider %s unavailable (status %d)", e.Provider, e.Status)
	}
	return fmt.Sprintf("authentication provider %s unavailable", e.Provider)
}

func (e *UnavailableError) Unwrap() error { return e.Cause }
