package main

import (
	"strings"
	"testing"
)

func TestTeamsHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "teams", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"list", "get", "members", "create", "join", "invite", "delete"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected teams help to contain %q, got: %s", sub, stdout)
		}
	}
}

func TestTeamsListHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "teams", "list", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "List teams") {
		t.Errorf("expected teams list help to mention listing, got: %s", stdout)
	}
}

func TestTeamsGetRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "get")
	if err == nil {
		t.Fatal("expected error when team ID is missing")
	}
}

func TestTeamsMembersHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "teams", "members", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"list", "remove"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected members help to contain %q, got: %s", sub, stdout)
		}
	}
}

func TestTeamsMembersListRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "members", "list")
	if err == nil {
		t.Fatal("expected error when team ID is missing")
	}
}

func TestTeamsMembersRemoveRequiresArgs(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "members", "remove")
	if err == nil {
		t.Fatal("expected error when team and subject IDs are missing")
	}
	_, _, err = executeCommand(root, "teams", "members", "remove", "team-id-only")
	if err == nil {
		t.Fatal("expected error when subject ID is missing")
	}
}

func TestTeamsDeleteRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "delete")
	if err == nil {
		t.Fatal("expected error when team ID is missing")
	}
}

func TestTeamsInviteDeleteRequiresArgs(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "invite", "delete")
	if err == nil {
		t.Fatal("expected error when team and invite IDs are missing")
	}
	_, _, err = executeCommand(root, "teams", "invite", "delete", "team-id-only")
	if err == nil {
		t.Fatal("expected error when invite ID is missing")
	}
}

func TestTeamsCreateRequiresName(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "create")
	if err == nil {
		t.Fatal("expected error when --name is missing")
	}
	if !strings.Contains(err.Error(), "name") {
		t.Errorf("expected error to mention --name, got: %v", err)
	}
}

func TestTeamsJoinRequiresCode(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "join")
	if err == nil {
		t.Fatal("expected error when --code is missing")
	}
	if !strings.Contains(err.Error(), "code") {
		t.Errorf("expected error to mention --code, got: %v", err)
	}
}

func TestTeamsInviteHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "teams", "invite", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"create", "list", "delete"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected invite help to contain %q, got: %s", sub, stdout)
		}
	}
}

func TestTeamsInviteCreateRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "invite", "create")
	if err == nil {
		t.Fatal("expected error when team ID is missing")
	}
}

func TestTeamsInviteCreateHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "teams", "invite", "create", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--role", "--expires", "--max-uses"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected invite create help to contain %q, got: %s", flag, stdout)
		}
	}
}

func TestTeamsInviteListRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "teams", "invite", "list")
	if err == nil {
		t.Fatal("expected error when team ID is missing")
	}
}
