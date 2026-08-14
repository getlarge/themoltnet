//go:build e2e

package main

import (
	"strings"
	"testing"
)

// TestE2E_PackListCmd covers `moltnet pack list` against a live API.
//
// The no-selector case is the point: `pack list` used to require --diary-id or
// --contains-entry, mirroring a REST route that rejected a bare GET /packs.
// That made the team catalog unreachable from both the CLI and the console.
func TestE2E_PackListCmd(t *testing.T) {
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}
	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write creds: %v", err)
	}

	t.Run("no selector lists the team catalog", func(t *testing.T) {
		stdout, stderr, err := runE2ECLI(binPath, credsPath, "pack", "list")
		if err != nil {
			t.Fatalf("pack list: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"items"`) {
			t.Errorf("expected an items array in the catalog response, got:\n%s", stdout)
		}
		if strings.Contains(stdout, "containsEntry is required") {
			t.Errorf("catalog listing should not demand a containsEntry filter:\n%s", stdout)
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
