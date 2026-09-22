package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestLegacyStoreNoticeOncePerProcessTree(t *testing.T) {
	t.Setenv("MOLTNET_AGENT_SERVER_ROOT", t.TempDir())
	t.Setenv("MOLTNET_LEGACY_STORE_NOTICE_SHOWN", "")
	run := func(args ...string) string {
		t.Helper()
		command := NewRootCmd("test", "")
		var output bytes.Buffer
		command.SetOut(&output)
		command.SetErr(&output)
		command.SetArgs(args)
		if err := command.Execute(); err != nil {
			t.Fatal(err)
		}
		return output.String()
	}
	if strings.Contains(run("--help"), "is deprecated") {
		t.Fatal("help printed a store warning")
	}
	if !strings.Contains(run("version"), "is deprecated") {
		t.Fatal("first invocation omitted notice")
	}
	if strings.Contains(run("version"), "is deprecated") {
		t.Fatal("inherited notice repeated")
	}
}

func TestLegacyStoreNoticeDoesNotPolluteHelpOrCompletion(t *testing.T) {
	for _, args := range [][]string{{"help"}, {"completion", "bash"}, {"__complete", "version", ""}, {"__completeNoDesc", "version", ""}} {
		t.Run(strings.Join(args, "_"), func(t *testing.T) {
			t.Setenv("MOLTNET_AGENT_SERVER_ROOT", t.TempDir())
			t.Setenv("MOLTNET_LEGACY_STORE_NOTICE_SHOWN", "")
			command := NewRootCmd("test", "")
			var output bytes.Buffer
			command.SetOut(&output)
			command.SetErr(&output)
			command.SetArgs(args)
			if err := command.Execute(); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(output.String(), "is deprecated") {
				t.Fatal("help/completion printed a store notice")
			}
			if os.Getenv("MOLTNET_LEGACY_STORE_NOTICE_SHOWN") != "" {
				t.Fatal("help/completion consumed the notice")
			}
		})
	}
}
