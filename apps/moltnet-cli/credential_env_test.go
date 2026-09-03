package main

import "testing"

// isolateCredentialDiscovery points credential auto-discovery at an empty
// temporary HOME and clears every environment variable that can select an
// activated identity.
//
// Setting HOME alone is not enough: MOLTNET_CREDENTIALS_PATH and
// GIT_CONFIG_GLOBAL are set in any activated LeGreffier shell, which is the
// normal state in this repository. A test that only isolates HOME therefore
// runs against the developer's real credentials and asserts something other
// than what it claims to.
func isolateCredentialDiscovery(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", "")
	return home
}
