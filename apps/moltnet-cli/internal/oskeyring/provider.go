package oskeyring

import "errors"

// ErrNotFound is returned when the requested secret does not exist.
var ErrNotFound = errors.New("secret not found")
