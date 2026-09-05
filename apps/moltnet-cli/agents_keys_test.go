package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// validAgentKey builds an AgentKey the generated client will accept when
// decoding a response: status is a valid enum, scopes is a required array, and
// the nullable revocationReason is explicitly null rather than an empty string.
func validAgentKey(id string) moltnetapi.AgentKey {
	k := moltnetapi.TeamAgentKey{
		ID:           id,
		AgentId:      uuid.MustParse(testAgentID),
		BindingScope: moltnetapi.TeamAgentKeyBindingScopeTeam,
		Name:         id,
		Scopes:       []moltnetapi.CredentialScope{},
		Status:       moltnetapi.AgentKeyStatusActive,
		TeamId:       uuid.MustParse(testTeamID),
	}
	k.CreatedAt.SetToNull()
	k.ExpiresAt.SetToNull()
	k.LastUsedAt.SetToNull()
	k.UpdatedAt.SetToNull()
	k.RevocationDescription.SetToNull()
	k.RevocationReason.SetToNull()
	return moltnetapi.NewTeamAgentKeyAgentKey(k)
}

// problemType is a non-empty URL for ProblemDetails.Type; the client rejects an
// empty url on decode.
var problemType = func() url.URL {
	u, _ := url.Parse("https://themolt.net/problems/forbidden")
	return *u
}()

const (
	testTeamID  = "6743b4b1-6b93-46e2-a048-19490f04f91a"
	testAgentID = "a854b555-aeef-4f13-ab22-8d0b819d478e"
)

// ----- pure param/body building -----

func TestBuildListAgentKeysParams(t *testing.T) {
	t.Parallel()

	t.Run("valid with all filters", func(t *testing.T) {
		t.Parallel()
		params, err := buildListAgentKeysParams(agentsKeysListOpts{
			teamID:    testTeamID,
			agentID:   testAgentID,
			agentSet:  true,
			status:    "active",
			statusSet: true,
			limit:     50,
			limitSet:  true,
			cursor:    "cur",
			cursorSet: true,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if v, ok := params.XMoltnetTeamID.Get(); !ok || v.String() != testTeamID {
			t.Errorf("team id = %s (set=%v), want %s", v, ok, testTeamID)
		}
		if v, ok := params.AgentId.Get(); !ok || v.String() != testAgentID {
			t.Errorf("agent id = %v (set=%v), want %s", v, ok, testAgentID)
		}
		if v, ok := params.Status.Get(); !ok || v != moltnetapi.ListAgentKeysStatusActive {
			t.Errorf("status = %v (set=%v), want active", v, ok)
		}
		if v, ok := params.Limit.Get(); !ok || v != 50 {
			t.Errorf("limit = %v (set=%v), want 50", v, ok)
		}
		if v, ok := params.Cursor.Get(); !ok || v != "cur" {
			t.Errorf("cursor = %v (set=%v), want cur", v, ok)
		}
	})

	t.Run("identity mode omits team and sets binding scope", func(t *testing.T) {
		t.Parallel()
		params, err := buildListAgentKeysParams(agentsKeysListOpts{identityScoped: true})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if params.XMoltnetTeamID.IsSet() {
			t.Fatal("identity mode must omit the team header")
		}
		if v, ok := params.BindingScope.Get(); !ok || v != moltnetapi.AgentKeyBindingScopeIdentity {
			t.Fatalf("bindingScope = %q (set=%v), want identity", v, ok)
		}
	})

	t.Run("invalid team id", func(t *testing.T) {
		t.Parallel()
		_, err := buildListAgentKeysParams(agentsKeysListOpts{teamID: "not-a-uuid"})
		if err == nil || !strings.Contains(err.Error(), "--team-id") {
			t.Fatalf("expected --team-id error, got %v", err)
		}
	})

	t.Run("identity mode sets the create discriminator", func(t *testing.T) {
		t.Parallel()
		req, params, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			identityScoped: true, agentID: testAgentID, name: "portable",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if params.XMoltnetTeamID.IsSet() {
			t.Fatal("identity mode must omit the team header")
		}
		if v, ok := req.BindingScope.Get(); !ok || v != moltnetapi.AgentKeyBindingScopeIdentity {
			t.Fatalf("bindingScope = %q (set=%v), want identity", v, ok)
		}
	})

	t.Run("invalid agent id", func(t *testing.T) {
		t.Parallel()
		_, err := buildListAgentKeysParams(agentsKeysListOpts{teamID: testTeamID, agentID: "nope", agentSet: true})
		if err == nil || !strings.Contains(err.Error(), "--agent-id") {
			t.Fatalf("expected --agent-id error, got %v", err)
		}
	})

	t.Run("invalid status", func(t *testing.T) {
		t.Parallel()
		_, err := buildListAgentKeysParams(agentsKeysListOpts{teamID: testTeamID, status: "bogus", statusSet: true})
		if err == nil || !strings.Contains(err.Error(), "--status") {
			t.Fatalf("expected --status error, got %v", err)
		}
	})

	t.Run("non-positive limit", func(t *testing.T) {
		t.Parallel()
		_, err := buildListAgentKeysParams(agentsKeysListOpts{teamID: testTeamID, limit: 0, limitSet: true})
		if err == nil || !strings.Contains(err.Error(), "--limit") {
			t.Fatalf("expected --limit error, got %v", err)
		}
	})
}

func TestBuildCreateAgentKey(t *testing.T) {
	t.Parallel()

	t.Run("generates idempotency key when unset", func(t *testing.T) {
		t.Parallel()
		req, params, key, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if key == "" {
			t.Fatal("expected a generated idempotency key")
		}
		if _, perr := uuid.Parse(key); perr != nil {
			t.Errorf("generated idempotency key %q is not a UUID: %v", key, perr)
		}
		if params.IdempotencyKey != key {
			t.Errorf("params idempotency key = %q, want %q", params.IdempotencyKey, key)
		}
		if req.AgentId.String() != testAgentID {
			t.Errorf("req agent id = %s, want %s", req.AgentId, testAgentID)
		}
		if req.Name != "ci" {
			t.Errorf("req name = %q, want ci", req.Name)
		}
	})

	t.Run("honors provided idempotency key", func(t *testing.T) {
		t.Parallel()
		_, params, key, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
			idempotencyKey: "fixed-key", idempotencySet: true,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if key != "fixed-key" || params.IdempotencyKey != "fixed-key" {
			t.Errorf("idempotency key = %q / %q, want fixed-key", key, params.IdempotencyKey)
		}
	})

	t.Run("ttl days when set", func(t *testing.T) {
		t.Parallel()
		req, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci", ttlDays: 30, ttlSet: true,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if v, ok := req.TtlDays.Get(); !ok || v != 30 {
			t.Errorf("ttlDays = %v (set=%v), want 30", v, ok)
		}
	})

	t.Run("rejects non-positive ttl", func(t *testing.T) {
		t.Parallel()
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci", ttlDays: 0, ttlSet: true,
		})
		if err == nil || !strings.Contains(err.Error(), "--ttl-days") {
			t.Fatalf("expected --ttl-days error, got %v", err)
		}
	})

	t.Run("omits scopes when unset so the server default applies", func(t *testing.T) {
		t.Parallel()
		req, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(req.Scopes) != 0 {
			t.Errorf("scopes = %v, want empty", req.Scopes)
		}
	})

	t.Run("passes the requested scopes through in order", func(t *testing.T) {
		t.Parallel()
		req, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "daemon",
			scopes: []string{"agent:profile", "runtime:read", "task:read", "task:claim", "task:execute"}, scopesSet: true,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := []moltnetapi.CredentialScope{
			"agent:profile", "runtime:read", "task:read", "task:claim", "task:execute",
		}
		if len(req.Scopes) != len(want) {
			t.Fatalf("scopes = %v, want %v", req.Scopes, want)
		}
		for i, scope := range want {
			if req.Scopes[i] != scope {
				t.Errorf("scopes[%d] = %q, want %q", i, req.Scopes[i], scope)
			}
		}
	})

	t.Run("rejects an unknown scope", func(t *testing.T) {
		t.Parallel()
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
			scopes: []string{"agent:profile", "task:teleport"}, scopesSet: true,
		})
		if err == nil || !strings.Contains(err.Error(), "task:teleport") {
			t.Fatalf("expected unknown-scope error, got %v", err)
		}
	})

	t.Run("rejects a duplicated scope", func(t *testing.T) {
		t.Parallel()
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
			scopes: []string{"task:read", "task:read"}, scopesSet: true,
		})
		if err == nil || !strings.Contains(err.Error(), "more than once") {
			t.Fatalf("expected duplicate-scope error, got %v", err)
		}
	})

	t.Run("rejects an empty scope value", func(t *testing.T) {
		t.Parallel()
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
			scopes: []string{"task:read", "  "}, scopesSet: true,
		})
		if err == nil || !strings.Contains(err.Error(), "empty value") {
			t.Fatalf("expected empty-scope error, got %v", err)
		}
	})

	t.Run("rejects an explicitly empty --scopes instead of widening the grant", func(t *testing.T) {
		t.Parallel()
		// pflag parses `--scopes ""` to a zero-length slice. Treating that as
		// "unset" would mint the full default agent grant for a caller who
		// believed they had narrowed it.
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{
			teamID: testTeamID, agentID: testAgentID, name: "ci",
			scopes: nil, scopesSet: true,
		})
		if err == nil || !strings.Contains(err.Error(), "--scopes was given but empty") {
			t.Fatalf("expected empty --scopes error, got %v", err)
		}
	})

	t.Run("rejects missing name", func(t *testing.T) {
		t.Parallel()
		_, _, _, err := buildCreateAgentKey(agentsKeysCreateOpts{teamID: testTeamID, agentID: testAgentID})
		if err == nil || !strings.Contains(err.Error(), "--name") {
			t.Fatalf("expected --name error, got %v", err)
		}
	})
}

func TestBuildRevokeReason(t *testing.T) {
	t.Parallel()

	cases := []struct {
		reason string
		want   moltnetapi.RevokeAgentKeyReqType
	}{
		{"key_compromise", moltnetapi.ProvenanceGraphKeyCompromiseNodeRevokeAgentKeyReq},
		{"affiliation_changed", moltnetapi.ProvenanceGraphAffiliationChangedNodeRevokeAgentKeyReq},
		{"superseded", moltnetapi.ProvenanceGraphSupersededNodeRevokeAgentKeyReq},
		{"privilege_withdrawn", moltnetapi.ProvenanceGraphPrivilegeWithdrawnNodeRevokeAgentKeyReq},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.reason, func(t *testing.T) {
			t.Parallel()
			body, err := buildRevokeReason(tc.reason, "", false)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !body.Set {
				t.Fatal("expected body to be set")
			}
			if body.Value.Type != tc.want {
				t.Errorf("type = %q, want %q", body.Value.Type, tc.want)
			}
		})
	}

	t.Run("empty reason is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := buildRevokeReason("", "", false)
		if err == nil || !strings.Contains(err.Error(), "--reason is required") {
			t.Fatalf("expected required error, got %v", err)
		}
	})

	t.Run("unknown reason is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := buildRevokeReason("nuked", "", false)
		if err == nil || !strings.Contains(err.Error(), "invalid --reason") {
			t.Fatalf("expected invalid error, got %v", err)
		}
	})

	t.Run("description rejected for non privilege_withdrawn", func(t *testing.T) {
		t.Parallel()
		_, err := buildRevokeReason("key_compromise", "why", true)
		if err == nil || !strings.Contains(err.Error(), "--description is only valid") {
			t.Fatalf("expected description-scope error, got %v", err)
		}
	})

	t.Run("description accepted for privilege_withdrawn", func(t *testing.T) {
		t.Parallel()
		body, err := buildRevokeReason("privilege_withdrawn", "contract ended", true)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		desc, ok := body.Value.ProvenanceGraphPrivilegeWithdrawnNode.Description.Get()
		if !ok || desc != "contract ended" {
			t.Errorf("description = %q (set=%v), want 'contract ended'", desc, ok)
		}
	})
}

// ----- pagination aggregation (no network) -----

func TestCollectAllAgentKeys(t *testing.T) {
	t.Parallel()

	t.Run("follows cursor across pages", func(t *testing.T) {
		t.Parallel()
		pages := map[string]*moltnetapi.AgentKeyList{
			"": {Items: []moltnetapi.AgentKey{validAgentKey("k1")}, NextCursor: moltnetapi.NewNilString("c2")},
			"c2": {Items: []moltnetapi.AgentKey{validAgentKey("k2"), validAgentKey("k3")}, NextCursor: func() moltnetapi.NilString {
				n := moltnetapi.NilString{}
				n.SetToNull()
				return n
			}()},
		}
		var calls int
		fetch := func(cursor moltnetapi.OptString) (*moltnetapi.AgentKeyList, error) {
			calls++
			c, _ := cursor.Get()
			return pages[c], nil
		}
		got, err := collectAllAgentKeys(moltnetapi.OptString{}, fetch)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if calls != 2 {
			t.Errorf("fetch calls = %d, want 2", calls)
		}
		if len(got.Items) != 3 {
			t.Errorf("aggregated items = %d, want 3", len(got.Items))
		}
		if !got.NextCursor.IsNull() {
			t.Errorf("aggregated nextCursor should be null, got %+v", got.NextCursor)
		}
	})

	t.Run("rejects a repeated cursor to avoid infinite loop", func(t *testing.T) {
		t.Parallel()
		fetch := func(cursor moltnetapi.OptString) (*moltnetapi.AgentKeyList, error) {
			return &moltnetapi.AgentKeyList{
				Items:      []moltnetapi.AgentKey{validAgentKey("loop")},
				NextCursor: moltnetapi.NewNilString("same"),
			}, nil
		}
		_, err := collectAllAgentKeys(moltnetapi.OptString{}, fetch)
		if err == nil || !strings.Contains(err.Error(), "repeated cursor") {
			t.Fatalf("expected repeated-cursor error, got %v", err)
		}
	})
}

// ----- end-to-end via in-process server -----

// agentKeysStubHandler overrides only the four agent-key operations; every other
// operation falls through to UnimplementedHandler (501).
type agentKeysStubHandler struct {
	moltnetapi.UnimplementedHandler
	create func(*moltnetapi.CreateAgentKeyReq, moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes
	list   func(moltnetapi.ListAgentKeysParams) moltnetapi.ListAgentKeysRes
	rotate func(moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes
	revoke func(moltnetapi.OptRevokeAgentKeyReq, moltnetapi.RevokeAgentKeyParams) moltnetapi.RevokeAgentKeyRes
}

func (h agentKeysStubHandler) CreateAgentKey(_ context.Context, req *moltnetapi.CreateAgentKeyReq, params moltnetapi.CreateAgentKeyParams) (moltnetapi.CreateAgentKeyRes, error) {
	return h.create(req, params), nil
}

func (h agentKeysStubHandler) ListAgentKeys(_ context.Context, params moltnetapi.ListAgentKeysParams) (moltnetapi.ListAgentKeysRes, error) {
	return h.list(params), nil
}

func (h agentKeysStubHandler) RotateAgentKey(_ context.Context, params moltnetapi.RotateAgentKeyParams) (moltnetapi.RotateAgentKeyRes, error) {
	return h.rotate(params), nil
}

func (h agentKeysStubHandler) RevokeAgentKey(_ context.Context, req moltnetapi.OptRevokeAgentKeyReq, params moltnetapi.RevokeAgentKeyParams) (moltnetapi.RevokeAgentKeyRes, error) {
	return h.revoke(req, params), nil
}

func TestRunAgentsKeysCreate_SecretOnlyInResult(t *testing.T) {
	t.Parallel()
	const secret = "sk_live_TOPSECRET_do_not_leak"

	handler := agentKeysStubHandler{
		create: func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{
				Key:    validAgentKey("key-1"),
				Secret: secret,
			}
		},
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		teamID: testTeamID, agentID: testAgentID, name: "ci",
		out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Secret appears exactly once, on stdout, inside the JSON result.
	if !strings.Contains(out.String(), secret) {
		t.Errorf("stdout should contain the secret, got: %s", out.String())
	}
	if strings.Contains(errOut.String(), secret) {
		t.Errorf("stderr notice must not contain the secret, got: %s", errOut.String())
	}
	if !strings.Contains(errOut.String(), "shown exactly once") {
		t.Errorf("stderr should carry the one-time-secret notice, got: %s", errOut.String())
	}

	var parsed createAgentKeyOutput
	if derr := json.Unmarshal(out.Bytes(), &parsed); derr != nil {
		t.Fatalf("stdout is not valid JSON: %v", derr)
	}
	if parsed.Secret != secret {
		t.Errorf("parsed secret = %q, want %q", parsed.Secret, secret)
	}
	if _, perr := uuid.Parse(parsed.IdempotencyKey); perr != nil {
		t.Errorf("result should echo a UUID idempotency key, got %q", parsed.IdempotencyKey)
	}
}

func TestRunAgentsKeysCreate_ErrorLeaksNothingToStdout(t *testing.T) {
	t.Parallel()

	handler := agentKeysStubHandler{
		create: func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
			return &moltnetapi.CreateAgentKeyForbidden{
				Code:   moltnetapi.ProblemDetailsCodeFORBIDDEN,
				Status: 403,
				Title:  "Forbidden",
				Type:   problemType,
			}
		},
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		teamID: testTeamID, agentID: testAgentID, name: "ci",
		out: &out, errOut: &errOut,
	})
	if err == nil {
		t.Fatal("expected an error for a 403 response")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("error should surface the status, got: %v", err)
	}
	if out.Len() != 0 {
		t.Errorf("nothing should be written to stdout on error, got: %s", out.String())
	}
	if strings.Contains(errOut.String(), "shown exactly once") {
		t.Errorf("the secret notice must not print when creation fails, got: %s", errOut.String())
	}
	// The auto-generated idempotency key must be surfaced so a retry can recover
	// instead of minting a duplicate.
	if !strings.Contains(errOut.String(), "--idempotency-key") {
		t.Errorf("stderr should surface the idempotency key for recovery, got: %s", errOut.String())
	}
}

func TestRunAgentsKeysRotate_SecretOnlyInResult(t *testing.T) {
	t.Parallel()
	const secret = "sk_live_ROTATED_do_not_leak"

	handler := agentKeysStubHandler{
		rotate: func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{
				Key:    validAgentKey("key-rotated"),
				Secret: secret,
			}
		},
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		teamID: testTeamID, keyID: "key-1", out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out.String(), secret) {
		t.Errorf("stdout should contain the rotated secret, got: %s", out.String())
	}
	if strings.Contains(errOut.String(), secret) {
		t.Errorf("stderr must not contain the rotated secret, got: %s", errOut.String())
	}
	if !strings.Contains(errOut.String(), "shown exactly once") {
		t.Errorf("rotate should carry the one-time-secret notice, got: %s", errOut.String())
	}
}

func TestRunAgentsKeysRotate_ErrorPaths(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		res  moltnetapi.RotateAgentKeyRes
		want string
	}{
		{
			name: "not found",
			res: &moltnetapi.RotateAgentKeyNotFound{
				Code: moltnetapi.ProblemDetailsCodeNOTFOUND, Status: 404, Title: "Not Found", Type: problemType,
			},
			want: "404",
		},
		{
			name: "rate limited",
			res: &moltnetapi.RotateAgentKeyTooManyRequests{
				Code: moltnetapi.ProblemDetailsCodeVALIDATIONFAILED, Status: 429, Title: "Too Many Requests", Type: problemType,
			},
			want: "429",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			handler := agentKeysStubHandler{
				rotate: func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes { return tc.res },
			}
			_, _, client := newTestServer(t, handler)
			var out, errOut bytes.Buffer
			err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
				teamID: testTeamID, keyID: "key-1", out: &out, errOut: &errOut,
			})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
			if strings.Contains(errOut.String(), "shown exactly once") || out.Len() != 0 {
				t.Errorf("no secret notice or stdout output on error; stdout=%q stderr=%q", out.String(), errOut.String())
			}
		})
	}
}

func TestRunAgentsKeysList_ErrorPath(t *testing.T) {
	t.Parallel()

	handler := agentKeysStubHandler{
		list: func(_ moltnetapi.ListAgentKeysParams) moltnetapi.ListAgentKeysRes {
			return &moltnetapi.ListAgentKeysForbidden{
				Code: moltnetapi.ProblemDetailsCodeFORBIDDEN, Status: 403, Title: "Forbidden", Type: problemType,
			}
		},
	}
	_, _, client := newTestServer(t, handler)
	var out bytes.Buffer
	err := runAgentsKeysListWithClient(context.Background(), client, agentsKeysListOpts{teamID: testTeamID, out: &out})
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("expected 403 error, got %v", err)
	}
	if out.Len() != 0 {
		t.Errorf("nothing should reach stdout on a list error, got: %s", out.String())
	}
}

func TestRunAgentsKeysList_EmptyResultSet(t *testing.T) {
	t.Parallel()

	handler := agentKeysStubHandler{
		list: func(_ moltnetapi.ListAgentKeysParams) moltnetapi.ListAgentKeysRes {
			n := moltnetapi.NilString{}
			n.SetToNull()
			return &moltnetapi.AgentKeyList{Items: []moltnetapi.AgentKey{}, NextCursor: n}
		},
	}
	_, _, client := newTestServer(t, handler)

	for _, all := range []bool{false, true} {
		var out bytes.Buffer
		err := runAgentsKeysListWithClient(context.Background(), client, agentsKeysListOpts{teamID: testTeamID, all: all, out: &out})
		if err != nil {
			t.Fatalf("all=%v: unexpected error: %v", all, err)
		}
		var page moltnetapi.AgentKeyList
		if derr := json.Unmarshal(out.Bytes(), &page); derr != nil {
			t.Fatalf("all=%v: bad JSON: %v", all, derr)
		}
		if page.Items == nil {
			t.Errorf("all=%v: items should be a non-nil empty list", all)
		}
		if len(page.Items) != 0 {
			t.Errorf("all=%v: items should be empty, got %d", all, len(page.Items))
		}
		if !page.NextCursor.IsNull() {
			t.Errorf("all=%v: nextCursor should be null on an empty result", all)
		}
	}
}

func TestRunAgentsKeysList_SinglePageAndAll(t *testing.T) {
	t.Parallel()

	handler := agentKeysStubHandler{
		list: func(params moltnetapi.ListAgentKeysParams) moltnetapi.ListAgentKeysRes {
			cursor, _ := params.Cursor.Get()
			switch cursor {
			case "":
				return &moltnetapi.AgentKeyList{
					Items:      []moltnetapi.AgentKey{validAgentKey("k1")},
					NextCursor: moltnetapi.NewNilString("page2"),
				}
			default:
				n := moltnetapi.NilString{}
				n.SetToNull()
				return &moltnetapi.AgentKeyList{Items: []moltnetapi.AgentKey{validAgentKey("k2")}, NextCursor: n}
			}
		},
	}
	_, _, client := newTestServer(t, handler)

	t.Run("single page surfaces nextCursor", func(t *testing.T) {
		var out bytes.Buffer
		err := runAgentsKeysListWithClient(context.Background(), client, agentsKeysListOpts{teamID: testTeamID, out: &out})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var page moltnetapi.AgentKeyList
		if derr := json.Unmarshal(out.Bytes(), &page); derr != nil {
			t.Fatalf("bad JSON: %v", derr)
		}
		if len(page.Items) != 1 {
			t.Errorf("items = %d, want 1", len(page.Items))
		}
		if v, ok := page.NextCursor.Get(); !ok || v != "page2" {
			t.Errorf("nextCursor = %q (set=%v), want page2", v, ok)
		}
	})

	t.Run("--all aggregates every page", func(t *testing.T) {
		var out bytes.Buffer
		err := runAgentsKeysListWithClient(context.Background(), client, agentsKeysListOpts{teamID: testTeamID, all: true, out: &out})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var page moltnetapi.AgentKeyList
		if derr := json.Unmarshal(out.Bytes(), &page); derr != nil {
			t.Fatalf("bad JSON: %v", derr)
		}
		if len(page.Items) != 2 {
			t.Errorf("aggregated items = %d, want 2", len(page.Items))
		}
		if !page.NextCursor.IsNull() {
			t.Errorf("aggregated nextCursor should be null, got %+v", page.NextCursor)
		}
	})
}

func TestRunAgentsKeysRevoke_NoContentPrintsConfirmation(t *testing.T) {
	t.Parallel()

	handler := agentKeysStubHandler{
		revoke: func(req moltnetapi.OptRevokeAgentKeyReq, _ moltnetapi.RevokeAgentKeyParams) moltnetapi.RevokeAgentKeyRes {
			if !req.Set {
				t.Error("revoke should send a reason body")
			}
			return &moltnetapi.RevokeAgentKeyNoContent{}
		},
	}
	_, _, client := newTestServer(t, handler)

	var out bytes.Buffer
	err := runAgentsKeysRevokeWithClient(context.Background(), client, agentsKeysRevokeOpts{
		teamID: testTeamID, keyID: "key-1", reason: "key_compromise", out: &out,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var confirm revokeAgentKeyOutput
	if derr := json.Unmarshal(out.Bytes(), &confirm); derr != nil {
		t.Fatalf("bad JSON: %v", derr)
	}
	if confirm.KeyID != "key-1" || confirm.Status != "revoked" || confirm.Reason != "key_compromise" {
		t.Errorf("confirmation = %+v", confirm)
	}
}

// ----- cobra wiring / help -----

func TestAgentsKeysHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "keys", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, want := range []string{"list", "create", "rotate", "revoke"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("agents keys help should mention %q, got: %s", want, stdout)
		}
	}
}

// The opts-level tests construct agentsKeysCreateOpts directly, so they cannot
// catch --scopes being unwired from cobra or pflag parsing the value into a
// shape the parser never sees. These drive the real command.
func TestAgentsKeysCreateScopesFlagWiring(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		arg     string
		wantErr string
	}{
		{name: "empty value does not silently widen the grant", arg: "", wantErr: "--scopes was given but empty"},
		{name: "unknown scope fails before any request", arg: "task:read,task:teleport", wantErr: "task:teleport"},
		{name: "duplicate scope is rejected", arg: "task:read,task:read", wantErr: "more than once"},
		{name: "blank element is rejected", arg: "task:read, ", wantErr: "empty value"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			root := NewRootCmd("test", "")
			_, _, err := executeCommand(root, "agents", "keys", "create",
				"--team-id", testTeamID, "--agent-id", testAgentID,
				"--name", "ci", "--scopes", tc.arg)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestAgentsKeysCreateHelpFlags(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "keys", "create", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, want := range []string{"--team-id", "--identity-scoped", "--agent-id", "--name", "--scopes", "--ttl-days", "--idempotency-key"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("create help should contain %q, got: %s", want, stdout)
		}
	}
}

func TestAgentsKeysRevokeHelpListsReasons(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "keys", "revoke", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, want := range []string{"key_compromise", "affiliation_changed", "superseded", "privilege_withdrawn"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("revoke help should list reason %q, got: %s", want, stdout)
		}
	}
}

func TestAgentsKeysListRequiresTeamID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "keys", "list")
	if err == nil || !strings.Contains(err.Error(), "team-id") {
		t.Fatalf("expected required team-id error, got %v", err)
	}
}

func TestAgentsKeysBindingFlagsConflictBeforeHTTP(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "keys", "list", "--team-id", testTeamID, "--identity-scoped")
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("expected a flag conflict before HTTP, got %v", err)
	}
}

func TestAgentsKeysRevokeRequiresReason(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "keys", "revoke", "key-1", "--team-id", testTeamID)
	if err == nil || !strings.Contains(err.Error(), "reason") {
		t.Fatalf("expected required reason error, got %v", err)
	}
}
