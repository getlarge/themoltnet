package main

import (
	"strings"
	"testing"
)

func TestInfoHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "info", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Display information") {
		t.Errorf("expected help to contain 'Display information', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--json") {
		t.Errorf("expected help to contain '--json', got: %s", stdout)
	}
}

func TestInfoMissingServer(t *testing.T) {
	root := NewRootCmd()
	_, _, err := executeCommand(root, "info", "--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable server, got nil")
	}
	if !strings.Contains(err.Error(), "connect") && !strings.Contains(err.Error(), "refused") &&
		!strings.Contains(err.Error(), "dial") {
		t.Errorf("expected connection error, got: %v", err)
	}
}

func TestRegisterRequiresVoucher(t *testing.T) {
	root := NewRootCmd()
	_, _, err := executeCommand(root, "register")
	if err == nil {
		t.Fatal("expected error when voucher is missing, got nil")
	}
	if !strings.Contains(err.Error(), "voucher") {
		t.Errorf("expected error to mention 'voucher', got: %v", err)
	}
}

func TestRegisterHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "register", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--voucher") {
		t.Errorf("expected help to contain '--voucher', got: %s", stdout)
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected help to contain 'Example', got: %s", stdout)
	}
}

func TestSSHKeyHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "ssh-key", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--output-dir") {
		t.Errorf("expected help to contain '--output-dir', got: %s", stdout)
	}
}
