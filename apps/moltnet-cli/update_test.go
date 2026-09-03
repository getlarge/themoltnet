package main

import "testing"

func TestCompareVersions(t *testing.T) {
	if got := compareVersions("1.90.0", "1.89.9"); got != 1 {
		t.Fatalf("newer = %d, want 1", got)
	}
	if got := compareVersions("1.89.9", "1.90.0"); got != -1 {
		t.Fatalf("older = %d, want -1", got)
	}
	if got := compareVersions("bad", "1.90.0"); got != 0 {
		t.Fatalf("invalid = %d, want 0", got)
	}
}

func TestCLIUpdateCommands(t *testing.T) {
	cases := map[string]string{"homebrew": "brew upgrade --cask moltnet", "apt": "sudo apt update && sudo apt install --only-upgrade moltnet", "scoop": "scoop update moltnet", "npm": "npm install -g @themoltnet/cli@latest"}
	for method, want := range cases {
		if got := cliUpdateCommand(method, "/usr/local/bin/moltnet"); got != want {
			t.Errorf("%s: %q", method, got)
		}
	}
	if got := cliUpdateCommand("direct", "/usr/local/bin/moltnet"); got == "" {
		t.Fatal("direct command is empty")
	}
}

func TestDetectCLIInstallMethod(t *testing.T) {
	for path, want := range map[string]string{"/opt/homebrew/Caskroom/moltnet/1.0/moltnet": "homebrew", "/Users/a/scoop/apps/moltnet/current/moltnet.exe": "scoop", "/usr/lib/node_modules/@themoltnet/cli/bin/moltnet": "npm", "/usr/local/bin/moltnet": "direct"} {
		if got := detectCLIInstallMethod(path); got != want {
			t.Errorf("%s: got %q want %q", path, got, want)
		}
	}
}
