package main

import (
	"bytes"
	"context"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

type identityPublishHandler struct {
	moltnetapi.UnimplementedHandler
	subjectID   uuid.UUID
	publicKey   string
	fingerprint string
	// alias is the network alias whoami currently reports; empty means unset.
	alias string
	// updateRes, when set, replaces the successful UpdateWhoami response.
	updateRes   moltnetapi.UpdateWhoamiRes
	whoamiCalls int
	published   []string
}

func (h *identityPublishHandler) GetWhoami(_ context.Context) (moltnetapi.GetWhoamiRes, error) {
	h.whoamiCalls++
	whoami := &moltnetapi.Whoami{
		IdentityId:  uuid.New(),
		SubjectId:   h.subjectID,
		SubjectType: moltnetapi.WhoamiSubjectTypeAgent,
		PublicKey:   moltnetapi.NewOptString(h.publicKey),
		Fingerprint: moltnetapi.NewOptString(h.fingerprint),
		Scopes:      []string{"agent:profile"},
	}
	if h.alias != "" {
		whoami.Alias = moltnetapi.NewOptString(h.alias)
	}
	return whoami, nil
}

func (h *identityPublishHandler) UpdateWhoami(
	_ context.Context,
	req *moltnetapi.UpdateWhoamiReq,
) (moltnetapi.UpdateWhoamiRes, error) {
	if req == nil {
		return &moltnetapi.UpdateWhoamiBadRequest{}, nil
	}
	h.published = append(h.published, req.Alias)
	if h.updateRes != nil {
		return h.updateRes, nil
	}
	return &moltnetapi.UpdateWhoamiResponse{
		SubjectId:   h.subjectID,
		Fingerprint: h.fingerprint,
		Alias:       req.Alias,
	}, nil
}

// publishFixture is a stored central identity whose credential the handler
// recognises as the same agent.
type publishFixture struct {
	handler *identityPublishHandler
	server  *httptest.Server
	creds   *CredentialsFile
	path    string
	alias   string
}

func newPublishFixture(t *testing.T, alias string) *publishFixture {
	t.Helper()
	subjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: subjectID}
	server, _ := newCLICommandTestServer(t, handler)
	creds, path := writePublishIdentity(t, alias, server.URL, subjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint
	return &publishFixture{
		handler: handler,
		server:  server,
		creds:   creds,
		path:    path,
		alias:   alias,
	}
}

func writePublishIdentity(
	t *testing.T,
	alias string,
	serverURL string,
	subjectID uuid.UUID,
) (*CredentialsFile, string) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
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
	f := newPublishFixture(t, "Active.Agent")
	if err := writeIdentitySelector("Active.Agent"); err != nil {
		t.Fatal(err)
	}

	stdout, stderr, err := executeCommand(NewRootCmd("test", ""), "config", "identity", "publish")
	if err != nil {
		t.Fatalf("publish active identity: %v\nstderr: %s", err, stderr)
	}
	if len(f.handler.published) != 1 || f.handler.published[0] != "Active.Agent" {
		t.Fatalf("published aliases = %v", f.handler.published)
	}
	if strings.Contains(stdout, "publish-secret") || strings.Contains(stdout, f.creds.Keys.PrivateKey) {
		t.Fatalf("stdout contains secret material: %s", stdout)
	}
	if !strings.Contains(stdout, `"alias": "Active.Agent"`) ||
		!strings.Contains(stdout, f.creds.Keys.Fingerprint) {
		t.Fatalf("unexpected output: %s", stdout)
	}
}

func TestConfigIdentityPublishUsesExplicitAlias(t *testing.T) {
	f := newPublishFixture(t, "Explicit_Agent")

	_, _, err := executeCommand(NewRootCmd("test", ""), "config", "identity", "publish", "Explicit_Agent")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.handler.published) != 1 || f.handler.published[0] != "Explicit_Agent" {
		t.Fatalf("published aliases = %v", f.handler.published)
	}
}

func TestConfigIdentityPublishHonorsExplicitAPIURL(t *testing.T) {
	// Arrange: the stored endpoint is unreachable, so only --api-url can work.
	subjectID := uuid.New()
	handler := &identityPublishHandler{subjectID: subjectID}
	server, _ := newCLICommandTestServer(t, handler)
	creds, _ := writePublishIdentity(t, "flag-agent", "http://127.0.0.1:1", subjectID)
	handler.publicKey = creds.Keys.PublicKey
	handler.fingerprint = creds.Keys.Fingerprint

	// Act
	_, stderr, err := executeCommand(
		NewRootCmd("test", ""),
		"--api-url", server.URL,
		"config", "identity", "publish", "flag-agent",
	)

	// Assert
	if err != nil {
		t.Fatalf("publish with --api-url: %v\nstderr: %s", err, stderr)
	}
	if len(handler.published) != 1 || handler.published[0] != "flag-agent" {
		t.Fatalf("published aliases = %v", handler.published)
	}
}

func TestPublishIdentityAliasRefusesIdentityMismatch(t *testing.T) {
	f := newPublishFixture(t, "mismatch")
	f.handler.subjectID = uuid.New()

	_, err := publishIdentityAlias(context.Background(), f.server.URL, f.path, f.creds, "mismatch")
	if err == nil || !strings.Contains(err.Error(), "local subject_id does not match") {
		t.Fatalf("expected identity mismatch, got %v", err)
	}
	if len(f.handler.published) != 0 {
		t.Fatalf("alias was published despite mismatch: %v", f.handler.published)
	}
}

func TestPublishIdentityAliasRefusesDifferentUpdatedRecord(t *testing.T) {
	f := newPublishFixture(t, "other-record")
	f.handler.updateRes = &moltnetapi.UpdateWhoamiResponse{
		SubjectId:   uuid.New(),
		Fingerprint: f.handler.fingerprint,
		Alias:       "other-record",
	}

	_, err := publishIdentityAlias(context.Background(), f.server.URL, f.path, f.creds, "other-record")
	if err == nil || !strings.Contains(err.Error(), "server updated a different agent record") {
		t.Fatalf("expected different-record error, got %v", err)
	}
}

func TestPublishIdentityAliasSkipsWriteWhenAliasIsCurrent(t *testing.T) {
	f := newPublishFixture(t, "Already.Current")
	f.handler.alias = "Already.Current"

	updated, err := publishIdentityAlias(context.Background(), f.server.URL, f.path, f.creds, "Already.Current")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.handler.published) != 0 {
		t.Fatalf("expected no PATCH, published = %v", f.handler.published)
	}
	if updated.Alias != "Already.Current" ||
		updated.SubjectId != f.handler.subjectID ||
		updated.Fingerprint != f.creds.Keys.Fingerprint {
		t.Fatalf("unexpected result: %+v", updated)
	}
}

func TestPublishIdentityAliasRewritesDifferentCurrentAlias(t *testing.T) {
	f := newPublishFixture(t, "new-alias")
	f.handler.alias = "old-alias"

	if _, err := publishIdentityAlias(context.Background(), f.server.URL, f.path, f.creds, "new-alias"); err != nil {
		t.Fatal(err)
	}
	if len(f.handler.published) != 1 || f.handler.published[0] != "new-alias" {
		t.Fatalf("published aliases = %v", f.handler.published)
	}
}

func TestPublishIdentityAliasRequiresLocalFingerprint(t *testing.T) {
	f := newPublishFixture(t, "no-fingerprint")
	f.creds.Keys.Fingerprint = "  "

	_, err := publishIdentityAlias(context.Background(), f.server.URL, f.path, f.creds, "no-fingerprint")
	if err == nil || !strings.Contains(err.Error(), "has no signing key fingerprint") {
		t.Fatalf("expected missing fingerprint error, got %v", err)
	}
	if f.handler.whoamiCalls != 0 || len(f.handler.published) != 0 {
		t.Fatalf("expected no request, whoami calls = %d, published = %v",
			f.handler.whoamiCalls, f.handler.published)
	}
}

func TestAttemptIdentityAliasPublicationRecoveryHint(t *testing.T) {
	const (
		hintNone       = ""
		hintRetry      = "Recover with: moltnet config identity publish"
		hintCredential = "Check the credential with: moltnet config identity show"
	)
	problem := func(status int, code moltnetapi.ProblemDetailsCode, title string) moltnetapi.ProblemDetails {
		return moltnetapi.ProblemDetails{
			Type:   url.URL{Scheme: "https", Host: "themolt.net", Path: "/problems/test"},
			Status: status,
			Code:   code,
			Title:  title,
		}
	}
	tests := []struct {
		name string
		// arrange adjusts the fixture and returns the API URL and credentials
		// path the attempt uses.
		arrange     func(t *testing.T, f *publishFixture) (apiURL, path string)
		wantMessage string
		wantHint    string
	}{
		{
			name: "server updates a different record",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				f.handler.updateRes = &moltnetapi.UpdateWhoamiResponse{
					SubjectId:   uuid.New(),
					Fingerprint: f.handler.fingerprint,
					Alias:       f.alias,
				}
				return f.server.URL, f.path
			},
			wantMessage: "server updated a different agent record",
			wantHint:    hintNone,
		},
		{
			name: "local subject does not match",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				f.handler.subjectID = uuid.New()
				return f.server.URL, f.path
			},
			wantMessage: "local subject_id does not match",
			wantHint:    hintNone,
		},
		{
			name: "local fingerprint missing",
			arrange: func(t *testing.T, f *publishFixture) (string, string) {
				f.creds.Keys.Fingerprint = ""
				if _, err := WriteConfigTo(f.creds, f.path); err != nil {
					t.Fatal(err)
				}
				return f.server.URL, f.path
			},
			wantMessage: "has no signing key fingerprint",
			wantHint:    hintNone,
		},
		{
			name: "credential unauthorized",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				pd := problem(401, moltnetapi.ProblemDetailsCodeUNAUTHORIZED, "Unauthorized")
				f.handler.updateRes = (*moltnetapi.UpdateWhoamiUnauthorized)(&pd)
				return f.server.URL, f.path
			},
			wantMessage: "HTTP 401",
			wantHint:    hintCredential,
		},
		{
			name: "credential forbidden",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				pd := problem(403, moltnetapi.ProblemDetailsCodeFORBIDDEN, "Forbidden")
				f.handler.updateRes = (*moltnetapi.UpdateWhoamiForbidden)(&pd)
				return f.server.URL, f.path
			},
			wantMessage: "HTTP 403",
			wantHint:    hintCredential,
		},
		{
			name: "server error",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				pd := problem(500, moltnetapi.ProblemDetailsCodeINTERNALSERVERERROR, "Internal Server Error")
				f.handler.updateRes = (*moltnetapi.UpdateWhoamiInternalServerError)(&pd)
				return f.server.URL, f.path
			},
			wantMessage: "HTTP 500",
			wantHint:    hintRetry,
		},
		{
			name: "transport failure",
			arrange: func(_ *testing.T, f *publishFixture) (string, string) {
				return "http://127.0.0.1:1", f.path
			},
			wantMessage: "publish identity alias",
			wantHint:    hintRetry,
		},
		{
			name: "credentials file missing",
			arrange: func(t *testing.T, _ *publishFixture) (string, string) {
				return "http://127.0.0.1:1", filepath.Join(t.TempDir(), "missing.json")
			},
			wantMessage: "",
			wantHint:    hintRetry,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Arrange
			f := newPublishFixture(t, "hint-agent")
			apiURL, path := tt.arrange(t, f)
			var stderr bytes.Buffer

			// Act
			attemptIdentityAliasPublication(&stderr, apiURL, path, f.alias, 5*time.Second)

			// Assert
			message := stderr.String()
			if !strings.Contains(message, "Warning: network alias publication failed") ||
				!strings.Contains(message, tt.wantMessage) {
				t.Fatalf("unexpected warning: %s", message)
			}
			for _, hint := range []string{hintRetry, hintCredential} {
				if want := hint == tt.wantHint; strings.Contains(message, hint) != want {
					t.Fatalf("hint %q present = %v, want %v:\n%s", hint, !want, want, message)
				}
			}
			if tt.wantHint == hintRetry && !strings.Contains(message, hintRetry+" hint-agent") {
				t.Fatalf("retry hint does not name the alias:\n%s", message)
			}
		})
	}
}

func TestAttemptIdentityAliasPublicationPublishesAfterStoredCredentials(t *testing.T) {
	f := newPublishFixture(t, "auto-publish")
	var stderr bytes.Buffer

	attemptIdentityAliasPublication(&stderr, f.server.URL, f.path, "auto-publish", 5*time.Second)

	if len(f.handler.published) != 1 || f.handler.published[0] != "auto-publish" {
		t.Fatalf("published aliases = %v", f.handler.published)
	}
	if !strings.Contains(stderr.String(), "Published network alias auto-publish") {
		t.Fatalf("unexpected status: %s", stderr.String())
	}
}
