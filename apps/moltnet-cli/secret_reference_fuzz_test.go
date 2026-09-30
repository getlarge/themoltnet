package main

import (
	"strings"
	"testing"
)

// Fuzz the credential reference boundary with arbitrary provider and key text.
func FuzzParseSecretReferenceString(f *testing.F) {
	for _, seed := range []string{
		"os-keyring:oauth2/subject/client",
		"env:MOLTNET_CLIENT_SECRET",
		"file:key:with:colons",
		"missing-colon",
		":key",
		"Upper:key",
		"provider:",
		"\x00:key",
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, input string) {
		ref, err := parseSecretReferenceString(input)
		if err != nil {
			if ref != (SecretReference{}) {
				t.Fatal("invalid reference returned a partial reference")
			}
			return
		}
		if ref.Provider == "" || ref.Key == "" ||
			strings.Contains(ref.Provider, ":") ||
			strings.ContainsAny(ref.Provider, " \t\r\n") ||
			ref.Provider != strings.ToLower(ref.Provider) {
			t.Fatal("accepted a malformed provider or empty key")
		}
		again, err := parseSecretReferenceString(ref.Provider + ":" + ref.Key)
		if err != nil || again != ref {
			t.Fatal("accepted reference failed a canonical round trip")
		}
	})
}
