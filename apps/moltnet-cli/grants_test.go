package main

import (
	"strings"
	"testing"
)

func TestDiaryGrantsHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "diary", "grants", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"list", "create", "revoke"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected grants help to contain %q, got: %s", sub, stdout)
		}
	}
}

func TestDiaryGrantsListRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "grants", "list")
	if err == nil {
		t.Fatal("expected error when diary ID is missing")
	}
}

func TestDiaryGrantsCreateRequiresFlags(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "grants", "create", "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("expected error when required flags missing")
	}
	for _, flag := range []string{"subject-id", "subject-ns", "role"} {
		if !strings.Contains(err.Error(), flag) {
			t.Errorf("expected error to mention %q, got: %v", flag, err)
		}
	}
}

func TestDiaryGrantsRevokeRequiresFlags(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "grants", "revoke", "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("expected error when required flags missing")
	}
}

func TestParseCreateGrantRole(t *testing.T) {
	t.Parallel()
	if _, err := parseCreateGrantRole("writer"); err != nil {
		t.Errorf("writer must be valid: %v", err)
	}
	if _, err := parseCreateGrantRole("manager"); err != nil {
		t.Errorf("manager must be valid: %v", err)
	}
	if _, err := parseCreateGrantRole("admin"); err == nil {
		t.Error("admin must be invalid")
	}
}

func TestParseCreateGrantSubjectNs(t *testing.T) {
	t.Parallel()
	for _, ns := range []string{"Agent", "Human", "Group"} {
		if _, err := parseCreateGrantSubjectNs(ns); err != nil {
			t.Errorf("%s must be valid: %v", ns, err)
		}
	}
	if _, err := parseCreateGrantSubjectNs("agent"); err == nil {
		t.Error("lowercase agent must be invalid (case-sensitive)")
	}
}

func TestParseRevokeGrantRoleAndNs(t *testing.T) {
	t.Parallel()
	if _, err := parseRevokeGrantRole("writer"); err != nil {
		t.Errorf("writer must be valid: %v", err)
	}
	if _, err := parseRevokeGrantRole("bogus"); err == nil {
		t.Error("bogus role must be invalid")
	}
	if _, err := parseRevokeGrantSubjectNs("Agent"); err != nil {
		t.Errorf("Agent must be valid: %v", err)
	}
	if _, err := parseRevokeGrantSubjectNs("bogus"); err == nil {
		t.Error("bogus ns must be invalid")
	}
}
