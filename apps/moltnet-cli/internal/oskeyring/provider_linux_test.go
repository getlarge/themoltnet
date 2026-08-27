//go:build linux

package oskeyring

import (
	"errors"
	"reflect"
	"testing"

	dbus "github.com/godbus/dbus/v5"
)

func TestLinuxAttributesSupportGoAndKeytarLookups(t *testing.T) {
	t.Parallel()
	want := map[string]string{
		"account":  "oauth2/identity/client",
		"service":  "themolt.net",
		"username": "oauth2/identity/client",
	}
	if got := linuxAttributes("themolt.net", "oauth2/identity/client"); !reflect.DeepEqual(got, want) {
		t.Fatalf("linuxAttributes() = %#v, want %#v", got, want)
	}
}

func TestResolveLinuxItemPrefersGoAttributesThenFallsBackToKeytar(t *testing.T) {
	t.Parallel()
	var queried []map[string]string
	search := func(attrs map[string]string) ([]dbus.ObjectPath, error) {
		queried = append(queried, attrs)
		if attrs["account"] == "oauth2/identity/client" {
			return []dbus.ObjectPath{"/org/freedesktop/secrets/collection/login/keytar"}, nil
		}
		return nil, nil
	}

	item, err := resolveLinuxItem(search, "themolt.net", "oauth2/identity/client")
	if err != nil {
		t.Fatalf("resolveLinuxItem() error = %v", err)
	}
	if item != "/org/freedesktop/secrets/collection/login/keytar" {
		t.Fatalf("resolveLinuxItem() = %q, want keytar item", item)
	}
	want := linuxLookupAttributes("themolt.net", "oauth2/identity/client")
	if !reflect.DeepEqual(queried, want) {
		t.Fatalf("search order = %#v, want %#v", queried, want)
	}
}

func TestResolveLinuxItemReturnsGoItemWithoutFallback(t *testing.T) {
	t.Parallel()
	calls := 0
	search := func(attrs map[string]string) ([]dbus.ObjectPath, error) {
		calls++
		return []dbus.ObjectPath{"/go-item"}, nil
	}

	item, err := resolveLinuxItem(search, "themolt.net", "key")
	if err != nil || item != "/go-item" {
		t.Fatalf("resolveLinuxItem() = %q, %v; want /go-item", item, err)
	}
	if calls != 1 {
		t.Fatalf("search calls = %d, want 1", calls)
	}
}

func TestResolveLinuxItemReportsNotFoundAndSearchErrors(t *testing.T) {
	t.Parallel()
	_, err := resolveLinuxItem(func(map[string]string) ([]dbus.ObjectPath, error) {
		return nil, nil
	}, "themolt.net", "missing")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("resolveLinuxItem() error = %v, want ErrNotFound", err)
	}

	boom := errors.New("dbus unavailable")
	_, err = resolveLinuxItem(func(map[string]string) ([]dbus.ObjectPath, error) {
		return nil, boom
	}, "themolt.net", "key")
	if !errors.Is(err, boom) {
		t.Fatalf("resolveLinuxItem() error = %v, want %v", err, boom)
	}
}
