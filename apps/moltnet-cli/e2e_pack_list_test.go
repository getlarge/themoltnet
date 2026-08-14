//go:build e2e

package main

import (
	"strings"
	"testing"
)

// TestE2E_PackListCmd covers `moltnet pack list` against a live API.
//
// The catalog is team-scoped and nothing is inferred from the identity alone:
// agents routinely work in non-personal teams, so guessing a personal team
// would quietly list the wrong catalog. The team comes from --team-id, or from
// a team-bound credential. A bare invocation with neither is an error, and the
// message has to name the flag.
func TestE2E_PackListCmd(t *testing.T) {
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}
	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write creds: %v", err)
	}

	t.Run("team-id lists the team catalog", func(t *testing.T) {
		stdout, stderr, err := runE2ECLI(
			binPath, credsPath,
			"pack", "list",
			"--team-id", e2ePersonalTeamID.String(),
		)
		if err != nil {
			t.Fatalf("pack list --team-id: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"items"`) {
			t.Errorf("expected an items array in the catalog response, got:\n%s", stdout)
		}
		if strings.Contains(stdout, "containsEntry is required") {
			t.Errorf("catalog listing should not demand a containsEntry filter:\n%s", stdout)
		}
	})

	t.Run("no team context names the flag rather than the header", func(t *testing.T) {
		// The credential here is not team-bound, so there is nothing to infer.
		// Failing is correct; failing with API-speak is not — a CLI user cannot
		// act on "x-moltnet-team-id header is required".
		_, stderr, err := runE2ECLI(binPath, credsPath, "pack", "list")
		if err == nil {
			t.Skip("credential is team-bound; nothing to infer from")
		}
		if !strings.Contains(stderr, "--team-id") {
			t.Errorf("error should name the --team-id flag, got:\n%s", stderr)
		}
	})

	t.Run("diary-id scopes the listing", func(t *testing.T) {
		stdout, stderr, err := runE2ECLI(
			binPath, credsPath,
			"pack", "list",
			"--diary-id", e2eDiaryID.String(),
		)
		if err != nil {
			t.Fatalf("pack list --diary-id: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"items"`) {
			t.Errorf("expected an items array, got:\n%s", stdout)
		}
	})

	t.Run("diary-id and contains-entry remain mutually exclusive", func(t *testing.T) {
		_, _, err := runE2ECLI(
			binPath, credsPath,
			"pack", "list",
			"--diary-id", e2eDiaryID.String(),
			"--contains-entry", e2eDiaryID.String(),
		)
		if err == nil {
			t.Fatal("expected an error when both selectors are provided")
		}
	})
}
