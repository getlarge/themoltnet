package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestTeamEnrollmentRequiresExplicitIssuanceAndRetryKey(t *testing.T) {
	for _, opts := range []teamsJoinOpts{
		{store: agentKeyStoreOpts{enabled: true}},
		{issueAgentKey: true},
		{issueAgentKey: true, idempotencyKey: "   "},
	} {
		var out bytes.Buffer
		opts.out = &out
		opts.errOut = &out
		err := runTeamsJoinWithOptions(opts)
		if err == nil || !strings.Contains(err.Error(), "requires") {
			t.Fatalf("expected validation before credential lookup: %v", err)
		}
		if out.Len() != 0 {
			t.Fatal("invalid enrollment emitted output")
		}
	}
}
