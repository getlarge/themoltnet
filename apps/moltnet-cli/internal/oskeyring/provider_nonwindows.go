//go:build !windows

package oskeyring

import (
	"errors"

	"github.com/zalando/go-keyring"
)

func Get(service, key string) (string, error) {
	value, err := keyring.Get(service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return value, err
}

func Set(service, key, value string) error {
	return keyring.Set(service, key, value)
}

func Delete(service, key string) error {
	err := keyring.Delete(service, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return ErrNotFound
	}
	return err
}
