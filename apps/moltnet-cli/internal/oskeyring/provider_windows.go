//go:build windows

package oskeyring

import (
	"errors"

	"github.com/danieljoos/wincred"
)

func target(service, key string) string {
	// @github/keytar uses service/account for generic Windows credentials.
	return service + "/" + key
}

func Get(service, key string) (string, error) {
	credential, err := wincred.GetGenericCredential(target(service, key))
	if errors.Is(err, wincred.ErrElementNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return string(credential.CredentialBlob), nil
}

func Set(service, key, value string) error {
	credential := wincred.NewGenericCredential(target(service, key))
	credential.UserName = key
	credential.CredentialBlob = []byte(value)
	credential.Persist = wincred.PersistEnterprise
	return credential.Write()
}

func Delete(service, key string) error {
	credential, err := wincred.GetGenericCredential(target(service, key))
	if errors.Is(err, wincred.ErrElementNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	return credential.Delete()
}
