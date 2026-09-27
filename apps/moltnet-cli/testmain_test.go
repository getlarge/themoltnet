//go:build !e2e

package main

import (
	"fmt"
	"os"
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
// isolateTestEnvironment (testenv_test.go) makes isolation the default rather
// than something each test has to remember, and the e2e TestMain calls it too.
// Tests needing their own HOME call setTestHome, which moves the store with it.
func TestMain(m *testing.M) {
	os.Exit(func() int {
		scratch, err := isolateTestEnvironment()
		if scratch != "" {
			defer func() { _ = os.RemoveAll(scratch) }()
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "test setup: %v\n", err)
			return 1
		}
		return m.Run()
	}())
}

// TestNativeKeyringGateSurvivesEnvScrub fails closed if the gate is dropped
// from the allowlist again.
//
// The scrub silently disabled the whole native-keyring suite once already: the
// variable was cleared before the tests that read it, so they skipped on every
// platform while the job still reported success. Nothing about that failure was
// visible in CI, which is why the invariant is asserted here rather than left
// to be rediscovered.
func TestNativeKeyringGateSurvivesEnvScrub(t *testing.T) {
	const gate = "MOLTNET_RUN_NATIVE_KEYRING_TESTS"
	if !preservedTestEnv[gate] {
		t.Fatalf("%s is not in preservedTestEnv; TestMain will clear it and the "+
			"native-keyring tests will skip everywhere while CI reports success", gate)
	}
	// The scrub itself must still work, or the isolation TestMain exists for is
	// gone. A credential variable is the thing that must not survive.
	if os.Getenv("MOLTNET_CLIENT_SECRET") != "" {
		t.Fatal("MOLTNET_CLIENT_SECRET survived the scrub")
	}
}
