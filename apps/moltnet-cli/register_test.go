package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type capturedRegistrationRequest struct {
	CredentialType string `json:"credentialType"`
	Proof          string `json:"proof"`
	PublicKey      string `json:"publicKey"`
}

func assertRegistrationProof(t *testing.T, request *http.Request, body capturedRegistrationRequest, message string) {
	t.Helper()
	nonce := request.Header.Get("Idempotency-Key")
	if len(nonce) != 43 {
		t.Fatalf("idempotency key length = %d, want 43", len(nonce))
	}
	publicKey, err := ParsePublicKey(body.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := base64.StdEncoding.DecodeString(body.Proof)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(publicKey, []byte(message), proof) {
		t.Fatal("registration proof did not verify")
	}
}

func TestDoRegisterSelfOAuth2(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		nonce := r.Header.Get("Idempotency-Key")
		assertRegistrationProof(t, r, body, buildSelfRegistrationMessage(nonce, body.PublicKey, body.CredentialType))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890", "publicKey": body.PublicKey,
			"credential": map[string]any{"type": "oauth2", "clientId": "client-id", "clientSecret": "client-secret"},
		})
	}))
	defer server.Close()

	result, err := DoRegister(server.URL, credentialTypeOAuth2)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.ClientID != "client-id" {
		t.Fatalf("client ID = %q", result.Response.Credential.ClientID)
	}
	if result.Response.SubjectID != "00000000-0000-4000-a000-000000000123" {
		t.Fatalf("subject ID = %q", result.Response.SubjectID)
	}
	if result.Response.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject type = %q", result.Response.SubjectType)
	}
}

func TestDoRegisterSelfAgentKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		nonce := r.Header.Get("Idempotency-Key")
		assertRegistrationProof(t, r, body, buildSelfRegistrationMessage(nonce, body.PublicKey, body.CredentialType))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890",
			"publicKey":   body.PublicKey,
			"credential": map[string]any{
				"type":   "agent_key",
				"secret": "secret",
				"key": map[string]any{
					"id":                    "key-1",
					"agentId":               "00000000-0000-0000-0000-000000000123",
					"bindingScope":          "identity",
					"name":                  "Bootstrap credential",
					"status":                "active",
					"scopes":                []string{},
					"createdAt":             nil,
					"expiresAt":             nil,
					"lastUsedAt":            nil,
					"updatedAt":             nil,
					"revocationReason":      nil,
					"revocationDescription": nil,
				},
			},
		})
	}))
	defer server.Close()

	result, err := DoRegister(server.URL, credentialTypeAgentKey)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.AgentKey != "secret" {
		t.Fatalf("agent key = %q", result.Response.Credential.AgentKey)
	}
}

func TestDoRegisterErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"type":"urn:moltnet:problem:registration-failed","title":"Registration Failed","status":403}`))
	}))
	defer server.Close()
	if _, err := DoRegister(server.URL, credentialTypeOAuth2); err == nil {
		t.Fatal("expected HTTP error")
	}
	if _, err := DoRegister("http://127.0.0.1:1", credentialTypeOAuth2); err == nil {
		t.Fatal("expected network error")
	}
	if _, err := DoRegister(server.URL, "password"); err == nil {
		t.Fatal("expected credential type validation error")
	}
}

func TestReportRegistrationStoredPublishesAliasBestEffort(t *testing.T) {
	const mcpNotice = "MCP config not written"
	tests := []struct {
		name        string
		unreachable bool
		noMCP       bool
		wantStderr  []string
		wantAbsent  []string
	}{
		{
			name:       "publication succeeds",
			wantStderr: []string{"Published network alias reg-agent", mcpNotice},
		},
		{
			name:        "publication failure still completes registration",
			unreachable: true,
			wantStderr: []string{
				"Warning: network alias publication failed",
				"Recover with: moltnet config identity publish reg-agent",
				mcpNotice,
			},
		},
		{
			name:       "no MCP notice when disabled",
			noMCP:      true,
			wantStderr: []string{"Published network alias reg-agent"},
			wantAbsent: []string{mcpNotice},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Arrange
			f := newPublishFixture(t, "reg-agent")
			apiURL := f.server.URL
			if tt.unreachable {
				apiURL = "http://127.0.0.1:1"
			}
			var stderr bytes.Buffer

			// Act
			reportRegistrationStored(&stderr, apiURL, f.path, "reg-agent", tt.noMCP)

			// Assert
			for _, want := range tt.wantStderr {
				if !strings.Contains(stderr.String(), want) {
					t.Fatalf("stderr missing %q:\n%s", want, stderr.String())
				}
			}
			for _, absent := range tt.wantAbsent {
				if strings.Contains(stderr.String(), absent) {
					t.Fatalf("stderr unexpectedly contains %q:\n%s", absent, stderr.String())
				}
			}
		})
	}
}
