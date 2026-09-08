package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

var (
	testPolicyID      = uuid.MustParse("9c11f859-0fb8-4ade-97c5-9c1662e30d8b")
	testPolicyOtherID = uuid.MustParse("00000000-0000-0000-0000-0000000000bb")
	testPolicyTeam    = uuid.MustParse("6743b4b1-6b93-46e2-a048-19490f04f91a")
)

const (
	testPolicyName      = "read-only-review"
	testPolicyOtherName = "diary-write"
)

// stubPolicyHandler implements only the runtime-policy operations the CLI uses
// and records the arguments each was called with so tests can assert wiring.
type stubPolicyHandler struct {
	moltnetapi.UnimplementedHandler
	listParams         moltnetapi.ListRuntimePoliciesParams
	getParams          moltnetapi.GetRuntimePolicyParams
	createBody         moltnetapi.OptCreateRuntimePolicyBody
	createParams       moltnetapi.CreateRuntimePolicyParams
	updateBody         moltnetapi.OptUpdateRuntimePolicyBody
	updateParams       moltnetapi.UpdateRuntimePolicyParams
	deleteParams       moltnetapi.DeleteRuntimePolicyParams
	boundParams        moltnetapi.GetRuntimeProfilePoliciesParams
	setPoliciesBody    moltnetapi.OptSetProfilePoliciesBody
	setPoliciesParams  moltnetapi.SetRuntimeProfilePoliciesParams
	allowedToolsParams moltnetapi.GetRuntimeProfileAllowedToolsParams
}

func newTestRuntimePolicy(name string) *moltnetapi.RuntimePolicyWithTools {
	return &moltnetapi.RuntimePolicyWithTools{
		ID:            testPolicyID,
		TeamId:        testPolicyTeam,
		Name:          name,
		Description:   moltnetapi.NilString{Null: true},
		Tools:         []string{"read", "grep"},
		ShellCommands: []moltnetapi.ShellCommandRule{{ArgvPrefix: []string{"git", "diff"}}},
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
}

func newTestRuntimePolicyListItem(id uuid.UUID, name string) moltnetapi.RuntimePolicy {
	return moltnetapi.RuntimePolicy{
		ID:          id,
		TeamId:      testPolicyTeam,
		Name:        name,
		Description: moltnetapi.NilString{Null: true},
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}

func (h *stubPolicyHandler) ListRuntimePolicies(_ context.Context, params moltnetapi.ListRuntimePoliciesParams) (moltnetapi.ListRuntimePoliciesRes, error) {
	h.listParams = params
	return &moltnetapi.RuntimePolicyList{
		Items: []moltnetapi.RuntimePolicy{
			newTestRuntimePolicyListItem(testPolicyID, testPolicyName),
			newTestRuntimePolicyListItem(testPolicyOtherID, testPolicyOtherName),
		},
	}, nil
}

func (h *stubPolicyHandler) GetRuntimePolicy(_ context.Context, params moltnetapi.GetRuntimePolicyParams) (moltnetapi.GetRuntimePolicyRes, error) {
	h.getParams = params
	p := newTestRuntimePolicy(testPolicyName)
	p.ID = params.PolicyId
	return p, nil
}

func (h *stubPolicyHandler) CreateRuntimePolicy(_ context.Context, req moltnetapi.OptCreateRuntimePolicyBody, params moltnetapi.CreateRuntimePolicyParams) (moltnetapi.CreateRuntimePolicyRes, error) {
	h.createBody = req
	h.createParams = params
	return newTestRuntimePolicy(req.Value.Name), nil
}

func (h *stubPolicyHandler) UpdateRuntimePolicy(_ context.Context, req moltnetapi.OptUpdateRuntimePolicyBody, params moltnetapi.UpdateRuntimePolicyParams) (moltnetapi.UpdateRuntimePolicyRes, error) {
	h.updateBody = req
	h.updateParams = params
	p := newTestRuntimePolicy("patched")
	p.ID = params.PolicyId
	return p, nil
}

func (h *stubPolicyHandler) DeleteRuntimePolicy(_ context.Context, params moltnetapi.DeleteRuntimePolicyParams) (moltnetapi.DeleteRuntimePolicyRes, error) {
	h.deleteParams = params
	return &moltnetapi.DeleteRuntimePolicyNoContent{}, nil
}

func (h *stubPolicyHandler) GetRuntimeProfilePolicies(_ context.Context, params moltnetapi.GetRuntimeProfilePoliciesParams) (moltnetapi.GetRuntimeProfilePoliciesRes, error) {
	h.boundParams = params
	return &moltnetapi.RuntimeProfilePoliciesResponse{PolicyIds: []uuid.UUID{testPolicyID}}, nil
}

func (h *stubPolicyHandler) SetRuntimeProfilePolicies(_ context.Context, req moltnetapi.OptSetProfilePoliciesBody, params moltnetapi.SetRuntimeProfilePoliciesParams) (moltnetapi.SetRuntimeProfilePoliciesRes, error) {
	h.setPoliciesBody = req
	h.setPoliciesParams = params
	return &moltnetapi.SetRuntimeProfilePoliciesNoContent{}, nil
}

func (h *stubPolicyHandler) GetRuntimeProfileAllowedTools(_ context.Context, params moltnetapi.GetRuntimeProfileAllowedToolsParams) (moltnetapi.GetRuntimeProfileAllowedToolsRes, error) {
	h.allowedToolsParams = params
	return &moltnetapi.AllowedToolsResponse{
		AllowedTools:           []string{"read", "grep"},
		AllowedShellCommands:   []moltnetapi.ShellCommandRule{{ArgvPrefix: []string{"git", "diff"}}},
		Enforcement:            moltnetapi.ToolEnforcementWatch,
		PolicySnapshotHash:     "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		RuntimeKind:            "gondolin_pi",
		RuntimeProfileRevision: 3,
	}, nil
}

// ListRuntimeProfiles lets profile-side binding commands resolve a profile name
// to an id through the same stub.
func (h *stubPolicyHandler) ListRuntimeProfiles(_ context.Context, _ moltnetapi.ListRuntimeProfilesParams) (moltnetapi.ListRuntimeProfilesRes, error) {
	return &moltnetapi.RuntimeProfileListResponse{
		Items: []moltnetapi.RuntimeProfileListResponseItemsItem{
			newTestRuntimeProfileListItem(testProfileID, testProfileName),
		},
	}, nil
}

func writeTempPolicyFile(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "policy.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write policy file: %v", err)
	}
	return path
}

func TestPolicyListPassesTeamHeader(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runPolicyListCmd(io.Discard, apiSrv.URL, credPath, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runPolicyListCmd() error: %v", err)
	}
	if handler.listParams.XMoltnetTeamID != testPolicyTeam {
		t.Fatalf("expected team header %s, got %s", testPolicyTeam, handler.listParams.XMoltnetTeamID)
	}
}

// The policy endpoints have no server-side team fallback, so an omitted
// --team-id has to fail locally with a usage error rather than reaching the API
// and coming back as an opaque 400.
func TestPolicyCommandsRequireTeamID(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	policyFile := writeTempPolicyFile(t, `{"name":"read-only-review","tools":["read"]}`)

	cases := map[string]func() error{
		"list":   func() error { return runPolicyListCmd(io.Discard, apiSrv.URL, credPath, "") },
		"get":    func() error { return runPolicyGetCmd(io.Discard, apiSrv.URL, credPath, testPolicyName, "") },
		"create": func() error { return runPolicyCreateCmd(io.Discard, apiSrv.URL, credPath, policyFile, "") },
		"update": func() error {
			return runPolicyUpdateCmd(io.Discard, apiSrv.URL, credPath, testPolicyName, policyFile, "")
		},
		"delete":        func() error { return runPolicyDeleteCmd(io.Discard, apiSrv.URL, credPath, testPolicyName, "") },
		"policies":      func() error { return runProfilePoliciesCmd(io.Discard, apiSrv.URL, credPath, testProfileName, "") },
		"allowed-tools": func() error { return runProfileAllowedToolsCmd(io.Discard, apiSrv.URL, credPath, testProfileName, "") },
	}

	for name, run := range cases {
		t.Run(name, func(t *testing.T) {
			// Act
			err := run()

			// Assert
			if err == nil {
				t.Fatalf("expected an error when --team-id is omitted")
			}
			if !strings.Contains(err.Error(), "--team-id is required") {
				t.Fatalf("expected a --team-id usage error, got: %v", err)
			}
		})
	}
}

func TestPolicyGetResolvesNameToID(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runPolicyGetCmd(io.Discard, apiSrv.URL, credPath, testPolicyOtherName, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runPolicyGetCmd() error: %v", err)
	}
	if handler.getParams.PolicyId != testPolicyOtherID {
		t.Fatalf("expected policy id %s, got %s", testPolicyOtherID, handler.getParams.PolicyId)
	}
}

func TestPolicyGetUnknownNameFails(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runPolicyGetCmd(io.Discard, apiSrv.URL, credPath, "does-not-exist", testPolicyTeam.String())

	// Assert
	if err == nil {
		t.Fatalf("expected an error for an unknown policy name")
	}
	if !strings.Contains(err.Error(), `no runtime policy named "does-not-exist"`) {
		t.Fatalf("expected a name-resolution error, got: %v", err)
	}
}

func TestPolicyCreateSendsDefinition(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	path := writeTempPolicyFile(t, `{
	  "name": "read-only-review",
	  "description": "Inspection access.",
	  "tools": ["read", "grep"],
	  "shellCommands": [{ "argvPrefix": ["git", "diff"] }]
	}`)

	// Act
	err := runPolicyCreateCmd(io.Discard, apiSrv.URL, credPath, path, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runPolicyCreateCmd() error: %v", err)
	}
	if handler.createParams.XMoltnetTeamID != testPolicyTeam {
		t.Fatalf("expected team header %s, got %s", testPolicyTeam, handler.createParams.XMoltnetTeamID)
	}
	body := handler.createBody.Value
	if body.Name != testPolicyName {
		t.Fatalf("expected name %q, got %q", testPolicyName, body.Name)
	}
	if len(body.Tools) != 2 || body.Tools[0] != "read" {
		t.Fatalf("expected tools [read grep], got %v", body.Tools)
	}
	if len(body.ShellCommands) != 1 || len(body.ShellCommands[0].ArgvPrefix) != 2 ||
		body.ShellCommands[0].ArgvPrefix[0] != "git" || body.ShellCommands[0].ArgvPrefix[1] != "diff" {
		t.Fatalf("expected one [git diff] argv prefix, got %v", body.ShellCommands)
	}
}

func TestPolicyUpdateSendsAddRemovePatch(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	path := writeTempPolicyFile(t, `{"addTools":["glob"],"removeTools":["write"]}`)

	// Act
	err := runPolicyUpdateCmd(io.Discard, apiSrv.URL, credPath, testPolicyName, path, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runPolicyUpdateCmd() error: %v", err)
	}
	if handler.updateParams.PolicyId != testPolicyID {
		t.Fatalf("expected policy id %s, got %s", testPolicyID, handler.updateParams.PolicyId)
	}
	body := handler.updateBody.Value
	if len(body.AddTools) != 1 || body.AddTools[0] != "glob" {
		t.Fatalf("expected addTools [glob], got %v", body.AddTools)
	}
	if len(body.RemoveTools) != 1 || body.RemoveTools[0] != "write" {
		t.Fatalf("expected removeTools [write], got %v", body.RemoveTools)
	}
}

func TestPolicyDeleteResolvesNameToID(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runPolicyDeleteCmd(io.Discard, apiSrv.URL, credPath, testPolicyName, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runPolicyDeleteCmd() error: %v", err)
	}
	if handler.deleteParams.PolicyId != testPolicyID {
		t.Fatalf("expected policy id %s, got %s", testPolicyID, handler.deleteParams.PolicyId)
	}
}

func TestProfileSetPoliciesResolvesEveryPolicyName(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileSetPoliciesCmd(io.Discard, io.Discard, apiSrv.URL, credPath, testProfileName,
		[]string{testPolicyName, testPolicyOtherName}, false, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileSetPoliciesCmd() error: %v", err)
	}
	if handler.setPoliciesParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.setPoliciesParams.ProfileId)
	}
	ids := handler.setPoliciesBody.Value.PolicyIds
	if len(ids) != 2 || ids[0] != testPolicyID || ids[1] != testPolicyOtherID {
		t.Fatalf("expected [%s %s], got %v", testPolicyID, testPolicyOtherID, ids)
	}
}

// The endpoint replaces rather than merges, so omitting --policy must not be
// read as "bind nothing" — that would silently strip a profile's allow-list.
func TestProfileSetPoliciesRequiresExplicitClear(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileSetPoliciesCmd(io.Discard, io.Discard, apiSrv.URL, credPath, testProfileName, nil, false, testPolicyTeam.String())

	// Assert
	if err == nil {
		t.Fatalf("expected an error when neither --policy nor --clear is given")
	}
	if !strings.Contains(err.Error(), "--clear") {
		t.Fatalf("expected the error to point at --clear, got: %v", err)
	}
	if handler.setPoliciesBody.Set {
		t.Fatalf("expected no request to be sent, got %#v", handler.setPoliciesBody.Value)
	}
}

func TestProfileSetPoliciesClearSendsEmptySet(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileSetPoliciesCmd(io.Discard, io.Discard, apiSrv.URL, credPath, testProfileName, nil, true, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileSetPoliciesCmd() error: %v", err)
	}
	if len(handler.setPoliciesBody.Value.PolicyIds) != 0 {
		t.Fatalf("expected an empty policy set, got %v", handler.setPoliciesBody.Value.PolicyIds)
	}
}

func TestProfileSetPoliciesRejectsClearWithPolicy(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileSetPoliciesCmd(io.Discard, io.Discard, apiSrv.URL, credPath, testProfileName,
		[]string{testPolicyName}, true, testPolicyTeam.String())

	// Assert
	if err == nil {
		t.Fatalf("expected an error when --clear is combined with --policy")
	}
	if handler.setPoliciesBody.Set {
		t.Fatalf("expected no request to be sent, got %#v", handler.setPoliciesBody.Value)
	}
}

func TestProfileAllowedToolsPassesProfileAndTeam(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileAllowedToolsCmd(io.Discard, apiSrv.URL, credPath, testProfileName, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileAllowedToolsCmd() error: %v", err)
	}
	if handler.allowedToolsParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.allowedToolsParams.ProfileId)
	}
	if handler.allowedToolsParams.XMoltnetTeamID != testPolicyTeam {
		t.Fatalf("expected team header %s, got %s", testPolicyTeam, handler.allowedToolsParams.XMoltnetTeamID)
	}
}

func TestProfilePoliciesPassesProfileAndTeam(t *testing.T) {
	// Arrange
	handler := &stubPolicyHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfilePoliciesCmd(io.Discard, apiSrv.URL, credPath, testProfileName, testPolicyTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfilePoliciesCmd() error: %v", err)
	}
	if handler.boundParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.boundParams.ProfileId)
	}
}
