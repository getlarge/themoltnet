//go:build linux

package oskeyring

import (
	"reflect"
	"testing"
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
