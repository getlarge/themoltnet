//go:build !e2e

package main

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// TestMain isolates the unit suite from the developer's real environment.
//
// Two things have gone wrong repeatedly without it. Tests that resolve the
// central identity store go through GetConfigDir, which reads $HOME — a test
// that forgets t.Setenv("HOME", …) writes synthetic identities, SSH keys and a
// dangling identity-selector.json into the developer's actual
// ~/.config/moltnet, and nothing in the run reports it. And an activated
// developer shell exports MOLTNET_* credentials, which do not fail a test so
// much as silently reroute it: a present MOLTNET_CLIENT_SECRET makes an
// env-file secret resolve to the environment provider instead of being
// persisted, so the test takes a different path locally than it does on a
// clean CI runner and only fails after the push.
//
// Redirecting HOME here makes isolation the default rather than something each
// test has to remember, and clearing the credential variables makes a local run
// match CI by construction. Tests needing their own HOME still call t.Setenv.
func TestMain(m *testing.M) {
	os.Exit(func() int {
		home, err := os.MkdirTemp("", "moltnet-unit-home-")
		if err != nil {
			fmt.Fprintf(os.Stderr, "test setup: create isolated HOME: %v\n", err)
			return 1
		}
		defer func() { _ = os.RemoveAll(home) }()
		if err := os.Setenv("HOME", home); err != nil {
			fmt.Fprintf(os.Stderr, "test setup: set HOME: %v\n", err)
			return 1
		}
		for _, entry := range os.Environ() {
			key, _, found := strings.Cut(entry, "=")
			if !found || !strings.HasPrefix(key, "MOLTNET_") {
				continue
			}
			if err := os.Unsetenv(key); err != nil {
				fmt.Fprintf(os.Stderr, "test setup: unset %s: %v\n", key, err)
				return 1
			}
		}
		if err := os.Unsetenv("GIT_CONFIG_GLOBAL"); err != nil {
			fmt.Fprintf(os.Stderr, "test setup: unset GIT_CONFIG_GLOBAL: %v\n", err)
			return 1
		}
		return m.Run()
	}())
}
