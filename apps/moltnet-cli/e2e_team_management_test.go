//go:build e2e

package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// TestE2E_CLI_TeamLifecycle exercises the full team management + diary
// grant flow through the compiled CLI binary: create team → invite → join
// (from a 2nd bootstrapped agent) → grant diary writer → list grants →
// revoke grant → remove member → delete invite → delete team.
func TestE2E_CLI_TeamLifecycle(t *testing.T) {
	h := newCLIHarness(t)

	// 1. owner creates a team
	teamName := "e2e-cli-team-" + uuid.NewString()[:8]
	stdout, _ := h.run(t, "teams", "create", "--name", teamName)
	var created struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	}
	decodeJSON(t, stdout, &created)
	if created.Name != teamName {
		t.Fatalf("team name mismatch: want %q got %q", teamName, created.Name)
	}
	teamID := created.ID
	t.Logf("created team %s (%s)", teamName, teamID)

	// 2. owner creates an invite (member role, 1 use)
	stdout, _ = h.run(t, "teams", "invite", "create", teamID.String(),
		"--role", "member", "--max-uses", "1")
	var invite struct {
		ID   uuid.UUID `json:"id"`
		Code string    `json:"code"`
	}
	decodeJSON(t, stdout, &invite)
	if invite.Code == "" {
		t.Fatal("expected invite code")
	}

	// 3. bootstrap a 2nd genesis agent to act as the invitee
	inviteeAgent, err := bootstrapGenesisAgent()
	if err != nil {
		t.Fatalf("bootstrap invitee agent: %v", err)
	}
	inviteeCreds := &CredentialsFile{
		IdentityID: inviteeAgent.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     inviteeAgent.ClientID,
			ClientSecret: inviteeAgent.ClientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:   inviteeAgent.PublicKey,
			PrivateKey:  inviteeAgent.PrivateKey,
			Fingerprint: inviteeAgent.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: e2eAPIURL},
	}
	inviteeCredsPath, err := writeE2ECredsFile(inviteeCreds)
	if err != nil {
		t.Fatalf("write invitee creds: %v", err)
	}
	// 4. invitee joins via CLI
	joinStdout, _, joinErr := runE2ECLI(h.bin, inviteeCredsPath,
		"teams", "join", "--code", invite.Code)
	if joinErr != nil {
		t.Fatalf("teams join: %v\nstdout: %s", joinErr, joinStdout)
	}
	var joined struct {
		TeamID uuid.UUID `json:"teamId"`
		Role   string    `json:"role"`
	}
	decodeJSON(t, joinStdout, &joined)
	if joined.TeamID != teamID {
		t.Errorf("joined team mismatch: want %s got %s", teamID, joined.TeamID)
	}
	if joined.Role != "member" {
		t.Errorf("joined role: want member got %s", joined.Role)
	}

	// The grant subject ID is the invitee's Kratos identity ID — Keto uses
	// identity_id directly as the subject for both team membership and diary
	// grants. We parse it from the bootstrap output; no ListTeamMembers round
	// trip is needed (and fingerprint isn't reliably populated there for
	// bootstrap agents anyway — metadata_public is only set by auth flow
	// webhooks, which genesis bootstrap bypasses).
	inviteeAgentID, err := uuid.Parse(inviteeAgent.IdentityID)
	if err != nil {
		t.Fatalf("parse invitee identity ID %q: %v", inviteeAgent.IdentityID, err)
	}

	// Sanity-check that the invitee is actually a member now.
	membersRes, err := e2eClient.ListTeamMembers(context.Background(),
		moltnetapi.ListTeamMembersParams{ID: teamID})
	if err != nil {
		t.Fatalf("list team members: %v", err)
	}
	members, ok := membersRes.(*moltnetapi.ListTeamMembersOK)
	if !ok {
		t.Fatalf("unexpected team members response: %T", membersRes)
	}
	var foundInvitee bool
	for _, m := range members.Items {
		if m.SubjectId == inviteeAgentID {
			foundInvitee = true
			break
		}
	}
	if !foundInvitee {
		t.Fatalf("invitee agent %s not found in team members", inviteeAgentID)
	}

	// 5. owner grants writer on the shared e2e diary to the invitee
	stdout, _ = h.run(t, "diary", "grants", "create", e2eDiaryID.String(),
		"--subject-id", inviteeAgentID.String(),
		"--subject-ns", "Agent",
		"--role", "writer")
	var grantCreated struct {
		Role      string    `json:"role"`
		SubjectId uuid.UUID `json:"subjectId"`
		SubjectNs string    `json:"subjectNs"`
	}
	decodeJSON(t, stdout, &grantCreated)
	if grantCreated.Role != "writer" {
		t.Errorf("grant role: want writer got %s", grantCreated.Role)
	}
	if grantCreated.SubjectId != inviteeAgentID {
		t.Errorf("grant subject: want %s got %s", inviteeAgentID, grantCreated.SubjectId)
	}

	// 5a. granting a DIFFERENT role on the same diary must fail with 409
	// (this is the uniqueness enforcement from Phase 1, verified here via CLI)
	_, confStderr, confErr := runE2ECLI(h.bin, h.creds,
		"diary", "grants", "create", e2eDiaryID.String(),
		"--subject-id", inviteeAgentID.String(),
		"--subject-ns", "Agent",
		"--role", "manager")
	if confErr == nil {
		t.Error("expected 409 conflict when granting a second role to same subject, got success")
	}
	if !strings.Contains(confStderr, "409") && !strings.Contains(confStderr, "Conflict") &&
		!strings.Contains(confStderr, "conflict") && !strings.Contains(confStderr, "already has") {
		t.Errorf("expected 409/conflict error, got stderr: %s", confStderr)
	}

	// 6. list grants — should contain the writer grant we created
	stdout, _ = h.run(t, "diary", "grants", "list", e2eDiaryID.String())
	var grantList struct {
		Grants []struct {
			Role      string    `json:"role"`
			SubjectId uuid.UUID `json:"subjectId"`
			SubjectNs string    `json:"subjectNs"`
		} `json:"grants"`
	}
	decodeJSON(t, stdout, &grantList)
	found := false
	for _, g := range grantList.Grants {
		if g.SubjectId == inviteeAgentID && g.Role == "writer" {
			found = true
			break
		}
	}
	if !found {
		b, _ := json.Marshal(grantList)
		t.Errorf("writer grant for invitee not found in list: %s", string(b))
	}

	// 7. revoke grant
	stdout, _ = h.run(t, "diary", "grants", "revoke", e2eDiaryID.String(),
		"--subject-id", inviteeAgentID.String(),
		"--subject-ns", "Agent",
		"--role", "writer")
	var revoked struct {
		Revoked bool `json:"revoked"`
	}
	decodeJSON(t, stdout, &revoked)
	if !revoked.Revoked {
		t.Error("expected revoked=true after revoke")
	}

	// 8. owner removes the team member
	stdout, _ = h.run(t, "teams", "members", "remove",
		teamID.String(), inviteeAgentID.String())
	if !strings.Contains(stdout, "removed") && !strings.Contains(stdout, "true") {
		t.Logf("member remove stdout: %s", stdout)
	}

	// 9. owner deletes the invite
	stdout, _ = h.run(t, "teams", "invite", "delete",
		teamID.String(), invite.ID.String())
	var inviteDeleted struct {
		Deleted bool `json:"deleted"`
	}
	decodeJSON(t, stdout, &inviteDeleted)
	if !inviteDeleted.Deleted {
		t.Error("expected deleted=true after invite delete")
	}

	// 10. owner deletes the team
	stdout, _ = h.run(t, "teams", "delete", teamID.String())
	var teamDeleted struct {
		Deleted bool `json:"deleted"`
	}
	decodeJSON(t, stdout, &teamDeleted)
	if !teamDeleted.Deleted {
		t.Error("expected deleted=true after team delete")
	}

	// 11. subsequent get should 404
	_, stderr, err := runE2ECLI(h.bin, h.creds, "teams", "get", teamID.String())
	if err == nil {
		t.Error("expected error fetching deleted team")
	}
	if !strings.Contains(stderr, "404") && !strings.Contains(stderr, "not found") {
		t.Logf("teams get after delete stderr: %s", stderr)
	}
}
