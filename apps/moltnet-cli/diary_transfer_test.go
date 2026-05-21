package main

import (
	"strings"
	"testing"
)

func TestDiaryTransferHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "diary", "transfer", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"initiate", "list", "accept", "reject"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected transfer help to contain %q, got: %s", sub, stdout)
		}
	}
}

func TestDiaryTransferInitiateRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "transfer", "initiate")
	if err == nil {
		t.Fatal("expected error when diary ID is missing")
	}
}

func TestDiaryTransferInitiateRequiresToTeamFlag(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "transfer", "initiate",
		"6e4d9948-8ec5-4f59-b82a-3acbc4bbc396")
	if err == nil {
		t.Fatal("expected error when --to-team flag missing")
	}
	if !strings.Contains(err.Error(), "to-team") {
		t.Errorf("expected error to mention to-team, got: %v", err)
	}
}

func TestDiaryTransferInitiateRejectsInvalidDiaryID(t *testing.T) {
	t.Parallel()
	err := runDiaryTransferInitiateCmd("http://example.test", "/nonexistent",
		"not-a-uuid", "6e4d9948-8ec5-4f59-b82a-3acbc4bbc396")
	if err == nil {
		t.Fatal("expected error on invalid diary ID")
	}
	if !strings.Contains(err.Error(), "invalid diary ID") {
		t.Errorf("expected error to mention diary ID, got: %v", err)
	}
}

func TestDiaryTransferInitiateRejectsInvalidDestinationTeamID(t *testing.T) {
	t.Parallel()
	err := runDiaryTransferInitiateCmd("http://example.test", "/nonexistent",
		"6e4d9948-8ec5-4f59-b82a-3acbc4bbc396", "not-a-uuid")
	if err == nil {
		t.Fatal("expected error on invalid destination team ID")
	}
	if !strings.Contains(err.Error(), "invalid destination team ID") {
		t.Errorf("expected error to mention destination team ID, got: %v", err)
	}
}

func TestDiaryTransferAcceptRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "transfer", "accept")
	if err == nil {
		t.Fatal("expected error when transfer ID is missing")
	}
}

func TestDiaryTransferAcceptRejectsInvalidUUID(t *testing.T) {
	t.Parallel()
	err := runDiaryTransferAcceptCmd("http://example.test", "/nonexistent", "not-a-uuid")
	if err == nil {
		t.Fatal("expected error on invalid transfer ID")
	}
	if !strings.Contains(err.Error(), "invalid transfer ID") {
		t.Errorf("expected error to mention transfer ID, got: %v", err)
	}
}

func TestDiaryTransferRejectRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "transfer", "reject")
	if err == nil {
		t.Fatal("expected error when transfer ID is missing")
	}
}

func TestDiaryTransferRejectRejectsInvalidUUID(t *testing.T) {
	t.Parallel()
	err := runDiaryTransferRejectCmd("http://example.test", "/nonexistent", "not-a-uuid")
	if err == nil {
		t.Fatal("expected error on invalid transfer ID")
	}
	if !strings.Contains(err.Error(), "invalid transfer ID") {
		t.Errorf("expected error to mention transfer ID, got: %v", err)
	}
}
