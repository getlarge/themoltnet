//go:build linux

package oskeyring

import (
	"fmt"

	dbus "github.com/godbus/dbus/v5"
	ss "github.com/zalando/go-keyring/secret_service"
)

func linuxAttributes(service, key string) map[string]string {
	return map[string]string{
		"account":  key,
		"service":  service,
		"username": key,
	}
}

// linuxSearch abstracts Secret Service item search so lookup order is unit-testable.
type linuxSearch func(attributes map[string]string) ([]dbus.ObjectPath, error)

// linuxLookupAttributes lists the attribute sets tried in order. Items written
// by this package and by zalando/go-keyring carry `username`; items written by
// keytar (the Node provider) carry only `account`.
func linuxLookupAttributes(service, key string) []map[string]string {
	return []map[string]string{
		{"service": service, "username": key},
		{"service": service, "account": key},
	}
}

func resolveLinuxItem(search linuxSearch, service, key string) (dbus.ObjectPath, error) {
	for _, attrs := range linuxLookupAttributes(service, key) {
		items, err := search(attrs)
		if err != nil {
			return "", err
		}
		if len(items) > 0 {
			return items[0], nil
		}
	}
	return "", ErrNotFound
}

func findLinuxItem(svc *ss.SecretService, service, key string) (dbus.ObjectPath, error) {
	collection := svc.GetLoginCollection()
	if err := svc.Unlock(collection.Path()); err != nil {
		return "", err
	}
	return resolveLinuxItem(func(attrs map[string]string) ([]dbus.ObjectPath, error) {
		return svc.SearchItems(collection, attrs)
	}, service, key)
}

func Get(service, key string) (string, error) {
	svc, err := ss.NewSecretService()
	if err != nil {
		return "", err
	}
	item, err := findLinuxItem(svc, service, key)
	if err != nil {
		return "", err
	}
	session, err := svc.OpenSession()
	if err != nil {
		return "", err
	}
	defer func() { _ = svc.Close(session) }()
	if err := svc.Unlock(item); err != nil {
		return "", err
	}
	secret, err := svc.GetSecret(item, session.Path())
	if err != nil {
		return "", err
	}
	return string(secret.Value), nil
}

func Set(service, key, value string) error {
	svc, err := ss.NewSecretService()
	if err != nil {
		return err
	}
	session, err := svc.OpenSession()
	if err != nil {
		return err
	}
	defer func() { _ = svc.Close(session) }()
	collection := svc.GetLoginCollection()
	if err := svc.Unlock(collection.Path()); err != nil {
		return err
	}
	return svc.CreateItem(
		collection,
		fmt.Sprintf("Password for '%s' on '%s'", key, service),
		linuxAttributes(service, key),
		ss.NewSecret(session.Path(), value),
	)
}

func Delete(service, key string) error {
	svc, err := ss.NewSecretService()
	if err != nil {
		return err
	}
	item, err := findLinuxItem(svc, service, key)
	if err != nil {
		return err
	}
	return svc.Delete(item)
}
