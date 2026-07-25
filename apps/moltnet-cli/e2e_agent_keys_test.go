//go:build e2e

package main

import (
	"context"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/ogen-go/ogen/ogenerrors"
)

// staticBearerSource authenticates the generated client with a fixed bearer
// token — here, an agent-key secret — so the test can verify that a secret
// authenticates while active and is rejected after rotation or revocation.
type staticBearerSource struct{ token string }

func (s staticBearerSource) BearerAuth(context.Context, moltnetapi.OperationName) (moltnetapi.BearerAuth, error) {
	return moltnetapi.BearerAuth{Token: s.token}, nil
}

func (s staticBearerSource) CookieAuth(context.Context, moltnetapi.OperationName) (moltnetapi.CookieAuth, error) {
	return moltnetapi.CookieAuth{}, ogenerrors.ErrSkipClientSecurity
}

func (s staticBearerSource) SessionAuth(context.Context, moltnetapi.OperationName) (moltnetapi.SessionAuth, error) {
	return moltnetapi.SessionAuth{}, ogenerrors.ErrSkipClientSecurity
}

// keyAuthenticates reports whether the given agent-key secret can authenticate a
// whoami call. A revoked or rotated-away secret yields a 401, which surfaces as
// a transport error or a non-Whoami response variant — either way, false.
func keyAuthenticates(t *testing.T, apiURL, secret string) bool {
	t.Helper()
	client, err := moltnetapi.NewClient(strings.TrimRight(apiURL, "/"), staticBearerSource{token: secret})
	if err != nil {
		t.Fatalf("build static-bearer client: %v", err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		return false
	}
	_, ok := res.(*moltnetapi.Whoami)
	return ok
}

// createAgentKeyResult mirrors the CLI create/rotate stdout JSON.
type e2eAgentKeyResult struct {
	Key struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"key"`
	Secret         string `json:"secret"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type e2eAgentKey struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type e2eAgentKeyList struct {
	Items      []e2eAgentKey `json:"items"`
	NextCursor *string       `json:"nextCursor"`
}

func TestE2E_CLI_AgentKeyLifecycle(t *testing.T) {
	h := newCLIHarness(t)
	team := e2ePersonalTeamID.String()
	agentID := e2eCreds.IdentityID
	idem1 := "e2e-cli-keys-" + uuid.NewString()

	// 1. Create — the secret is printed once in the result.
	stdout, stderr := h.run(t, "agents", "keys", "create",
		"--team-id", team, "--agent-id", agentID, "--name", "e2e-cli-primary",
		"--ttl-days", "1", "--idempotency-key", idem1)
	var created e2eAgentKeyResult
	decodeJSON(t, stdout, &created)
	if created.Secret == "" || created.Key.ID == "" {
		t.Fatalf("create did not return a secret and key id: %+v", created)
	}
	if created.IdempotencyKey != idem1 {
		t.Errorf("create should echo the idempotency key, got %q", created.IdempotencyKey)
	}
	if !strings.Contains(stderr, "shown exactly once") {
		t.Errorf("create should print the one-time-secret notice to stderr, got: %s", stderr)
	}
	if strings.Contains(stderr, created.Secret) {
		t.Errorf("the secret must never appear on stderr")
	}

	// 2. The fresh secret authenticates.
	if !keyAuthenticates(t, e2eAPIURL, created.Secret) {
		t.Fatal("newly created key secret should authenticate")
	}

	// 3. Replaying the same idempotency key cannot mint a second key: the API
	//    returns 409 and the CLI surfaces it as an error.
	_, replayErr, err := runE2ECLI(h.bin, h.creds, "agents", "keys", "create",
		"--team-id", team, "--agent-id", agentID, "--name", "e2e-cli-primary",
		"--ttl-days", "1", "--idempotency-key", idem1)
	if err == nil {
		t.Error("replaying the same idempotency key should fail")
	}
	if !strings.Contains(replayErr, "409") {
		t.Errorf("replay error should surface HTTP 409, got: %s", replayErr)
	}

	// 4. A second key so the list has multiple entries for pagination.
	stdout, _ = h.run(t, "agents", "keys", "create",
		"--team-id", team, "--agent-id", agentID, "--name", "e2e-cli-secondary",
		"--ttl-days", "1", "--idempotency-key", "e2e-cli-keys-"+uuid.NewString())
	var second e2eAgentKeyResult
	decodeJSON(t, stdout, &second)

	// 5. --all aggregates every page and includes both keys.
	stdout, _ = h.run(t, "agents", "keys", "list", "--team-id", team, "--agent-id", agentID, "--all")
	var all e2eAgentKeyList
	decodeJSON(t, stdout, &all)
	if !containsKey(all.Items, created.Key.ID) || !containsKey(all.Items, second.Key.ID) {
		t.Errorf("--all should include both created keys, got %+v", all.Items)
	}

	// 6. Manual pagination: a page of one surfaces a continuation cursor that
	//    fetches the next page.
	stdout, _ = h.run(t, "agents", "keys", "list", "--team-id", team, "--agent-id", agentID, "--limit", "1")
	var page1 e2eAgentKeyList
	decodeJSON(t, stdout, &page1)
	if len(page1.Items) != 1 {
		t.Fatalf("limit 1 should return one item, got %d", len(page1.Items))
	}
	if page1.NextCursor == nil || *page1.NextCursor == "" {
		t.Fatal("a bounded page with more results should surface a nextCursor")
	}
	stdout, _ = h.run(t, "agents", "keys", "list", "--team-id", team, "--agent-id", agentID,
		"--limit", "1", "--cursor", *page1.NextCursor)
	var page2 e2eAgentKeyList
	decodeJSON(t, stdout, &page2)
	if len(page2.Items) != 1 {
		t.Fatalf("second page should return one item, got %d", len(page2.Items))
	}
	if page2.Items[0].ID == page1.Items[0].ID {
		t.Error("the second page should differ from the first")
	}

	// 7. Rotate the primary key with independent OAuth2 authority. The old
	//    secret stops authenticating; the new one works.
	stdout, rotateStderr := h.run(t, "agents", "keys", "rotate", created.Key.ID, "--team-id", team)
	var rotated e2eAgentKeyResult
	decodeJSON(t, stdout, &rotated)
	if rotated.Secret == "" || rotated.Key.ID == created.Key.ID {
		t.Fatalf("rotate should return a new key id and secret, got %+v", rotated)
	}
	if !strings.Contains(rotateStderr, "shown exactly once") {
		t.Errorf("rotate should print the one-time-secret notice to stderr, got: %s", rotateStderr)
	}
	if strings.Contains(rotateStderr, rotated.Secret) {
		t.Error("the rotated secret must never appear on stderr")
	}
	if keyAuthenticates(t, e2eAPIURL, created.Secret) {
		t.Error("the pre-rotation secret must stop authenticating after rotation")
	}
	if !keyAuthenticates(t, e2eAPIURL, rotated.Secret) {
		t.Error("the rotated secret should authenticate")
	}

	// 8. Revoke the rotated key. The revoked secret is rejected.
	stdout, _ = h.run(t, "agents", "keys", "revoke", rotated.Key.ID,
		"--team-id", team, "--reason", "key_compromise")
	var revoked struct {
		KeyID  string `json:"keyId"`
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	decodeJSON(t, stdout, &revoked)
	if revoked.Status != "revoked" || revoked.KeyID != rotated.Key.ID || revoked.Reason != "key_compromise" {
		t.Errorf("unexpected revoke confirmation: %+v", revoked)
	}
	if keyAuthenticates(t, e2eAPIURL, rotated.Secret) {
		t.Error("a revoked secret must be rejected")
	}
}

func containsKey(items []e2eAgentKey, id string) bool {
	for _, it := range items {
		if it.ID == id {
			return true
		}
	}
	return false
}
