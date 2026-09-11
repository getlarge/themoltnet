package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

type identityPublishHandler struct {
	moltnetapi.UnimplementedHandler
	subjectID   uuid.UUID
	publicKey   string
	fingerprint string
	published   []string
}

func (h *identityPublishHandler) GetWhoami(_ context.Context) (moltnetapi.GetWhoamiRes, error) {
	return &moltnetapi.Whoami{
		IdentityId:  uuid.New(),
		SubjectId:   h.subjectID,
		SubjectType: moltnetapi.WhoamiSubjectTypeAgent,
		PublicKey:   moltnetapi.NewOptString(h.publicKey),
		Fingerprint: moltnetapi.NewOptString(h.fingerprint),
		Scopes:      []string{"agent:profile"},
	}, nil
}

func (h *identityPublishHandler) UpdateWhoami(
	_ context.Context,
	req *moltnetapi.UpdateWhoamiReq,
) (moltnetapi.UpdateWhoamiRes, error) {
	if req == nil {
		return &moltnetapi.UpdateWhoamiBadRequest{}, nil
	}
	h.published = append(h.published, req.Alias)
	return &moltnetapi.UpdateWhoamiResponse{
		SubjectId:   h.subjectID,
		Fingerprint: h.fingerprint,
		Alias:       req.Alias,
	}, nil
}

func newIdentityPublishServer(t *testing.T, handler *identityPublishHandler) *httptest.Server {
	t.Helper()
	generated, err := moltnetapi.NewServer(handler, noopSecurityHandler{})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "publish-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
			return
		}
		generated.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	return server
}

func writePublishIdentity(
	t *testing.T,
	alias string,
	serverURL string,
	subjectID uuid.UUID,
) (*CredentialsFile, string) {
	t.Helper()
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	path, err := identityCredentialsPath(alias)
	if err != nil {
		t.Fatal(err)
	}
	creds := &CredentialsFile{
		SubjectID:   subjectID.String(),
		SubjectType: SubjectTypeAgent,
		OAuth2:      CredentialsOAuth2{ClientID: "publish-client", ClientSecret: "publish-secret"},
		Keys: CredentialsKeys{
			PublicKey:   keyPair.PublicKey,
			PrivateKey:  keyPair.PrivateKey,
			Fingerprint: keyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: serverURL},
	}
	if _, err := WriteConfigTo(creds, path); err != nil {
		t.Fatal(err)
	}
	return creds, path
}

func TestConfigIdentityPublishUsesActiveAliasAndPrintsRedactedJSON(t *testing.T) {
	subjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: subjectID}
	server := newIdentityPublishServer(t, handler)
	creds, _ := writePublishIdentity(t, "Active.Agent", server.URL, subjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint
	if err := writeIdentitySelector("Active.Agent"); err != nil {
		t.Fatal(err)
	}

	stdout, stderr, err := executeCommand(NewRootCmd("test", ""), "config", "identity", "publish")
	if err != nil {
		t.Fatalf("publish active identity: %v\nstderr: %s", err, stderr)
	}
	if len(handler.published) != 1 || handler.published[0] != "Active.Agent" {
		t.Fatalf("published aliases = %v", handler.published)
	}
	if strings.Contains(stdout, "publish-secret") || strings.Contains(stdout, creds.Keys.PrivateKey) {
		t.Fatalf("stdout contains secret material: %s", stdout)
	}
	if !strings.Contains(stdout, `"alias": "Active.Agent"`) ||
		!strings.Contains(stdout, creds.Keys.Fingerprint) {
		t.Fatalf("unexpected output: %s", stdout)
	}
}

func TestConfigIdentityPublishUsesExplicitAlias(t *testing.T) {
	subjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: subjectID}
	server := newIdentityPublishServer(t, handler)
	creds, _ := writePublishIdentity(t, "Explicit_Agent", server.URL, subjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint

	_, _, err := executeCommand(NewRootCmd("test", ""), "config", "identity", "publish", "Explicit_Agent")
	if err != nil {
		t.Fatal(err)
	}
	if len(handler.published) != 1 || handler.published[0] != "Explicit_Agent" {
		t.Fatalf("published aliases = %v", handler.published)
	}
}

func TestPublishIdentityAliasRefusesIdentityMismatch(t *testing.T) {
	localSubjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: uuid.New()}
	server := newIdentityPublishServer(t, handler)
	creds, path := writePublishIdentity(t, "mismatch", server.URL, localSubjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint

	_, err := publishIdentityAlias(context.Background(), server.URL, path, "mismatch")
	if err == nil || !strings.Contains(err.Error(), "local subject_id does not match") {
		t.Fatalf("expected identity mismatch, got %v", err)
	}
	if len(handler.published) != 0 {
		t.Fatalf("alias was published despite mismatch: %v", handler.published)
	}
}

func TestAttemptIdentityAliasPublicationIsRecoverable(t *testing.T) {
	var stderr bytes.Buffer
	attemptIdentityAliasPublication(&stderr, "http://127.0.0.1:1", filepath.Join(t.TempDir(), "missing.json"), "recover-me")
	message := stderr.String()
	if !strings.Contains(message, "Warning: agent alias publication failed") ||
		!strings.Contains(message, "Recover with: moltnet config identity publish recover-me") {
		t.Fatalf("unexpected warning: %s", message)
	}
}

func TestAttemptIdentityAliasPublicationPublishesAfterStoredCredentials(t *testing.T) {
	subjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: subjectID}
	server := newIdentityPublishServer(t, handler)
	creds, path := writePublishIdentity(t, "auto-publish", server.URL, subjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint
	var stderr bytes.Buffer

	attemptIdentityAliasPublication(
		&stderr,
		server.URL,
		path,
		"auto-publish",
	)

	if len(handler.published) != 1 || handler.published[0] != "auto-publish" {
		t.Fatalf("published aliases = %v", handler.published)
	}
	if !strings.Contains(stderr.String(), "Published network alias auto-publish") {
		t.Fatalf("unexpected status: %s", stderr.String())
	}
}
