package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

var (
	testProfileID   = uuid.MustParse("1a653eb9-7bfa-475f-b517-c070c9c25b5e")
	testProfileTeam = uuid.MustParse("6743b4b1-6b93-46e2-a048-19490f04f91a")
)

const testProfileName = "standard-engineering"

// stubProfileHandler implements only the runtime-profile operations the CLI uses
// and records the arguments each was called with so tests can assert wiring.
type stubProfileHandler struct {
	moltnetapi.UnimplementedHandler
	listParams   moltnetapi.ListRuntimeProfilesParams
	getParams    moltnetapi.GetRuntimeProfileParams
	createBody   moltnetapi.OptCreateRuntimeProfileBody
	createParams moltnetapi.CreateRuntimeProfileParams
	updateBody   moltnetapi.OptUpdateRuntimeProfileBody
	updateParams moltnetapi.UpdateRuntimeProfileParams
	deleteParams moltnetapi.DeleteRuntimeProfileParams
}

func newTestRuntimeProfile(name string) *moltnetapi.RuntimeProfile {
	return &moltnetapi.RuntimeProfile{
		ID:       testProfileID,
		TeamId:   testProfileTeam,
		Name:     name,
		Provider: "anthropic",
		Model:    "claude-opus",
		AllowedWorkspaceModes: []moltnetapi.RuntimeProfileAllowedWorkspaceModesItem{
			moltnetapi.RuntimeProfileAllowedWorkspaceModesItemDedicatedWorktree,
		},
		DefaultWorkspaceMode: moltnetapi.NilRuntimeProfileDefaultWorkspaceMode{Null: true},
		ThinkingLevel:        moltnetapi.NilRuntimeProfileThinkingLevel{Null: true},
		MaxOutputTokens:      moltnetapi.NilInt{Null: true},
		TopK:                 moltnetapi.NilInt{Null: true},
		LeaseTtlSec:          60,
		MaxBatchSize:         1,
		SessionTtlSec:        3600,
		WorkspaceTtlSec:      3600,
		RuntimeKind:          "gondolin_pi",
		Sandbox:              moltnetapi.RuntimeProfileSandbox{},
		SessionStorageMode:   moltnetapi.RuntimeProfileSessionStorageModeLocal,
		WorkspaceStorageMode: moltnetapi.RuntimeProfileWorkspaceStorageModeLocal,
		ToolEnforcement:      moltnetapi.RuntimeProfileToolEnforcementOff,
		Revision:             1,
		DefinitionVersion:    2,
		DefinitionCid:        "bafytestcid",
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
}

func newTestRuntimeProfileListItem(id uuid.UUID, name string) moltnetapi.RuntimeProfileListResponseItemsItem {
	return moltnetapi.RuntimeProfileListResponseItemsItem{
		ID:       id,
		TeamId:   testProfileTeam,
		Name:     name,
		Provider: "anthropic",
		Model:    "claude-opus",
		AllowedWorkspaceModes: []moltnetapi.RuntimeProfileListResponseItemsItemAllowedWorkspaceModesItem{
			moltnetapi.RuntimeProfileListResponseItemsItemAllowedWorkspaceModesItemDedicatedWorktree,
		},
		DefaultWorkspaceMode: moltnetapi.NilRuntimeProfileListResponseItemsItemDefaultWorkspaceMode{Null: true},
		ThinkingLevel:        moltnetapi.NilRuntimeProfileListResponseItemsItemThinkingLevel{Null: true},
		MaxOutputTokens:      moltnetapi.NilInt{Null: true},
		TopK:                 moltnetapi.NilInt{Null: true},
		LeaseTtlSec:          60,
		MaxBatchSize:         1,
		SessionTtlSec:        3600,
		WorkspaceTtlSec:      3600,
		RuntimeKind:          "gondolin_pi",
		Sandbox:              moltnetapi.RuntimeProfileListResponseItemsItemSandbox{},
		SessionStorageMode:   moltnetapi.RuntimeProfileListResponseItemsItemSessionStorageModeLocal,
		WorkspaceStorageMode: moltnetapi.RuntimeProfileListResponseItemsItemWorkspaceStorageModeLocal,
		ToolEnforcement:      moltnetapi.RuntimeProfileListResponseItemsItemToolEnforcementOff,
		Revision:             1,
		DefinitionVersion:    2,
		DefinitionCid:        "bafytestcid",
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
}

func (h *stubProfileHandler) ListRuntimeProfiles(_ context.Context, params moltnetapi.ListRuntimeProfilesParams) (moltnetapi.ListRuntimeProfilesRes, error) {
	h.listParams = params
	return &moltnetapi.RuntimeProfileListResponse{
		Items: []moltnetapi.RuntimeProfileListResponseItemsItem{
			newTestRuntimeProfileListItem(testProfileID, testProfileName),
			newTestRuntimeProfileListItem(uuid.MustParse("00000000-0000-0000-0000-0000000000aa"), "run-eval-direct"),
		},
	}, nil
}

func (h *stubProfileHandler) GetRuntimeProfile(_ context.Context, params moltnetapi.GetRuntimeProfileParams) (moltnetapi.GetRuntimeProfileRes, error) {
	h.getParams = params
	p := newTestRuntimeProfile(testProfileName)
	p.ID = params.ProfileId
	return p, nil
}

func (h *stubProfileHandler) CreateRuntimeProfile(_ context.Context, req moltnetapi.OptCreateRuntimeProfileBody, params moltnetapi.CreateRuntimeProfileParams) (moltnetapi.CreateRuntimeProfileRes, error) {
	h.createBody = req
	h.createParams = params
	return newTestRuntimeProfile(req.Value.Name), nil
}

func (h *stubProfileHandler) UpdateRuntimeProfile(_ context.Context, req moltnetapi.OptUpdateRuntimeProfileBody, params moltnetapi.UpdateRuntimeProfileParams) (moltnetapi.UpdateRuntimeProfileRes, error) {
	h.updateBody = req
	h.updateParams = params
	p := newTestRuntimeProfile("patched")
	p.ID = params.ProfileId
	return p, nil
}

func (h *stubProfileHandler) DeleteRuntimeProfile(_ context.Context, params moltnetapi.DeleteRuntimeProfileParams) (moltnetapi.DeleteRuntimeProfileRes, error) {
	h.deleteParams = params
	return &moltnetapi.DeleteRuntimeProfileNoContent{}, nil
}

func writeTempProfileFile(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "profile.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write profile file: %v", err)
	}
	return path
}

func TestProfileListPassesTeamHeader(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileListCmd(apiSrv.URL, credPath, testProfileTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileListCmd() error: %v", err)
	}
	if !handler.listParams.XMoltnetTeamID.Set || handler.listParams.XMoltnetTeamID.Value != testProfileTeam {
		t.Fatalf("expected team header %s, got %#v", testProfileTeam, handler.listParams.XMoltnetTeamID)
	}
}

func TestProfileListOmitsTeamHeaderWhenUnset(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileListCmd(apiSrv.URL, credPath, "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileListCmd() error: %v", err)
	}
	if handler.listParams.XMoltnetTeamID.Set {
		t.Fatalf("expected no team header, got %#v", handler.listParams.XMoltnetTeamID)
	}
}

func TestProfileGetByID(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileGetCmd(apiSrv.URL, credPath, testProfileID.String(), "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileGetCmd() error: %v", err)
	}
	if handler.getParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.getParams.ProfileId)
	}
}

func TestProfileGetByNameResolvesViaList(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act — a name reference must be resolved to an id through a team-scoped list.
	err := runProfileGetCmd(apiSrv.URL, credPath, testProfileName, testProfileTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileGetCmd() error: %v", err)
	}
	if !handler.listParams.XMoltnetTeamID.Set || handler.listParams.XMoltnetTeamID.Value != testProfileTeam {
		t.Fatalf("expected resolution list scoped to team %s, got %#v", testProfileTeam, handler.listParams.XMoltnetTeamID)
	}
	if handler.getParams.ProfileId != testProfileID {
		t.Fatalf("expected resolved profile id %s, got %s", testProfileID, handler.getParams.ProfileId)
	}
}

func TestProfileGetByNameUsesCurrentTeamFallback(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act — no --team-id: the resolution list omits the team header so the server
	// scopes it to the token's current team, matching the documented fallback.
	err := runProfileGetCmd(apiSrv.URL, credPath, testProfileName, "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileGetCmd() error: %v", err)
	}
	if handler.listParams.XMoltnetTeamID.Set {
		t.Fatalf("expected no team header on the resolution list, got %#v", handler.listParams.XMoltnetTeamID)
	}
	if handler.getParams.ProfileId != testProfileID {
		t.Fatalf("expected resolved profile id %s, got %s", testProfileID, handler.getParams.ProfileId)
	}
}

func TestProfileGetByUnknownNameFails(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileGetCmd(apiSrv.URL, credPath, "does-not-exist", testProfileTeam.String())

	// Assert
	if err == nil {
		t.Fatal("expected error for an unknown profile name")
	}
}

func TestProfileCreateFromFile(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	file := writeTempProfileFile(t, `{
	  "name": "standard-engineering",
	  "provider": "anthropic",
	  "model": "claude-opus",
	  "sandbox": {}
	}`)

	// Act
	err := runProfileCreateCmd(apiSrv.URL, credPath, file, testProfileTeam.String())

	// Assert
	if err != nil {
		t.Fatalf("runProfileCreateCmd() error: %v", err)
	}
	if !handler.createBody.Set {
		t.Fatal("expected create body to be set")
	}
	if handler.createBody.Value.Name != testProfileName {
		t.Fatalf("expected name %q, got %q", testProfileName, handler.createBody.Value.Name)
	}
	if handler.createBody.Value.Provider != "anthropic" || handler.createBody.Value.Model != "claude-opus" {
		t.Fatalf("unexpected provider/model: %q/%q", handler.createBody.Value.Provider, handler.createBody.Value.Model)
	}
	if !handler.createParams.XMoltnetTeamID.Set || handler.createParams.XMoltnetTeamID.Value != testProfileTeam {
		t.Fatalf("expected team header %s, got %#v", testProfileTeam, handler.createParams.XMoltnetTeamID)
	}
}

func TestProfileCreateMissingFileFails(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileCreateCmd(apiSrv.URL, credPath, filepath.Join(t.TempDir(), "nope.json"), "")

	// Assert
	if err == nil {
		t.Fatal("expected error for a missing profile file")
	}
}

func TestProfileUpdateFromFile(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	file := writeTempProfileFile(t, `{"model": "claude-sonnet"}`)

	// Act
	err := runProfileUpdateCmd(apiSrv.URL, credPath, testProfileID.String(), file, "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileUpdateCmd() error: %v", err)
	}
	if handler.updateParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.updateParams.ProfileId)
	}
	if !handler.updateBody.Set || !handler.updateBody.Value.Model.Set || handler.updateBody.Value.Model.Value != "claude-sonnet" {
		t.Fatalf("expected patched model, got %#v", handler.updateBody.Value.Model)
	}
}

func TestProfileDeleteByID(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)

	// Act
	err := runProfileDeleteCmd(apiSrv.URL, credPath, testProfileID.String(), "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileDeleteCmd() error: %v", err)
	}
	if handler.deleteParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.deleteParams.ProfileId)
	}
}

// setStdin points os.Stdin at a file holding contents for the duration of the
// test. These tests must not run in parallel because os.Stdin is process-global.
func setStdin(t *testing.T, contents string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "stdin.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write stdin file: %v", err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open stdin file: %v", err)
	}
	orig := os.Stdin
	os.Stdin = f
	t.Cleanup(func() {
		os.Stdin = orig
		_ = f.Close()
	})
}

func TestProfileCreateFromStdin(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	setStdin(t, `{"name":"standard-engineering","provider":"anthropic","model":"claude-opus","sandbox":{}}`)

	// Act
	err := runProfileCreateCmd(apiSrv.URL, credPath, "-", "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileCreateCmd() error: %v", err)
	}
	if !handler.createBody.Set || handler.createBody.Value.Name != testProfileName {
		t.Fatalf("expected create body name %q, got %#v", testProfileName, handler.createBody)
	}
}

func TestProfileUpdateFromStdin(t *testing.T) {
	// Arrange
	handler := &stubProfileHandler{}
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	setStdin(t, `{"model":"claude-sonnet"}`)

	// Act
	err := runProfileUpdateCmd(apiSrv.URL, credPath, testProfileID.String(), "-", "")

	// Assert
	if err != nil {
		t.Fatalf("runProfileUpdateCmd() error: %v", err)
	}
	if !handler.updateBody.Set || !handler.updateBody.Value.Model.Set || handler.updateBody.Value.Model.Value != "claude-sonnet" {
		t.Fatalf("expected patched model, got %#v", handler.updateBody.Value.Model)
	}
}

// --- Root-command wiring tests ---
//
// These execute through NewRootCmd so that command registration, subcommand
// dispatch, positional-argument contracts, required flags, and persistent-flag
// propagation are exercised end to end — plumbing the handler-level tests above
// cannot catch.

func runProfileRoot(t *testing.T, handler *stubProfileHandler, args ...string) error {
	t.Helper()
	apiSrv, credPath := newCLICommandTestServer(t, handler)
	root := NewRootCmd("test", "")
	full := append([]string{"profile", args[0], "--api-url", apiSrv.URL, "--credentials", credPath}, args[1:]...)
	_, _, err := executeCommand(root, full...)
	return err
}

func TestProfileRootListDispatches(t *testing.T) {
	handler := &stubProfileHandler{}
	if err := runProfileRoot(t, handler, "list", "--team-id", testProfileTeam.String()); err != nil {
		t.Fatalf("profile list via root: %v", err)
	}
	if !handler.listParams.XMoltnetTeamID.Set || handler.listParams.XMoltnetTeamID.Value != testProfileTeam {
		t.Fatalf("expected team header propagated, got %#v", handler.listParams.XMoltnetTeamID)
	}
}

func TestProfileRootGetDispatches(t *testing.T) {
	handler := &stubProfileHandler{}
	if err := runProfileRoot(t, handler, "get", testProfileID.String()); err != nil {
		t.Fatalf("profile get via root: %v", err)
	}
	if handler.getParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.getParams.ProfileId)
	}
}

func TestProfileRootCreateDispatches(t *testing.T) {
	handler := &stubProfileHandler{}
	file := writeTempProfileFile(t, `{"name":"standard-engineering","provider":"anthropic","model":"claude-opus","sandbox":{}}`)
	if err := runProfileRoot(t, handler, "create", "--from-file", file, "--team-id", testProfileTeam.String()); err != nil {
		t.Fatalf("profile create via root: %v", err)
	}
	if !handler.createBody.Set || handler.createBody.Value.Name != testProfileName {
		t.Fatalf("expected create body name %q, got %#v", testProfileName, handler.createBody)
	}
}

func TestProfileRootUpdateDispatches(t *testing.T) {
	handler := &stubProfileHandler{}
	file := writeTempProfileFile(t, `{"model":"claude-sonnet"}`)
	if err := runProfileRoot(t, handler, "update", testProfileID.String(), "--from-file", file); err != nil {
		t.Fatalf("profile update via root: %v", err)
	}
	if handler.updateParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.updateParams.ProfileId)
	}
}

func TestProfileRootDeleteDispatches(t *testing.T) {
	handler := &stubProfileHandler{}
	if err := runProfileRoot(t, handler, "delete", testProfileID.String()); err != nil {
		t.Fatalf("profile delete via root: %v", err)
	}
	if handler.deleteParams.ProfileId != testProfileID {
		t.Fatalf("expected profile id %s, got %s", testProfileID, handler.deleteParams.ProfileId)
	}
}

func TestProfileRootArgumentContracts(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{"get requires a positional", []string{"get"}},
		{"delete requires a positional", []string{"delete"}},
		{"update requires a positional", []string{"update", "--from-file", "x.json"}},
		{"create requires --from-file", []string{"create"}},
		{"list rejects a positional", []string{"list", "unexpected"}},
		{"create rejects a positional", []string{"create", "unexpected", "--from-file", "x.json"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := NewRootCmd("test", "")
			// No --api-url/--credentials: a well-formed invocation would reach the
			// network, but these must fail during cobra argument validation first.
			_, _, err := executeCommand(root, append([]string{"profile"}, tc.args...)...)
			if err == nil {
				t.Fatalf("expected an argument-contract error for %q", tc.args)
			}
		})
	}
}
