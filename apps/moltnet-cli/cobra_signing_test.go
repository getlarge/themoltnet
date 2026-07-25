package main

import (
	"strings"
	"testing"
)

func TestSigningCommandsAreRegistered(t *testing.T) {
	root := NewRootCmd("test", "")

	for _, command := range []string{"signing-requests", "signing-credentials"} {
		stdout, _, err := executeCommand(root, command, "--help")
		if err != nil {
			t.Fatalf("%s --help: %v", command, err)
		}
		if !strings.Contains(stdout, "Usage:") {
			t.Fatalf("expected %s help, got %q", command, stdout)
		}
	}
}

func TestSigningRequestCreateRequiresMessage(t *testing.T) {
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "signing-requests", "create")
	if err == nil || !strings.Contains(err.Error(), "message") {
		t.Fatalf("expected required message error, got %v", err)
	}
}

func TestSigningCredentialCommandsRequireTeam(t *testing.T) {
	for _, args := range [][]string{
		{"signing-credentials", "list"},
		{"signing-credentials", "approve", signingCommandCredentialID.String()},
		{"signing-credentials", "suspend", signingCommandCredentialID.String()},
		{"signing-credentials", "revoke", signingCommandCredentialID.String()},
	} {
		root := NewRootCmd("test", "")
		_, _, err := executeCommand(root, args...)
		if err == nil || !strings.Contains(err.Error(), "team-id") {
			t.Fatalf("expected required team-id error for %v, got %v", args, err)
		}
	}
}
