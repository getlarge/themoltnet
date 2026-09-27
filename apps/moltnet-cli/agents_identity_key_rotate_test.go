package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

const rotateFixtureSubject = "00000000-0000-4000-8000-00000000c0de"

type identityRotateFixture struct {
	credentialsPath string
	keyring         *memorySecretProvider
	registry        *SecretProviderRegistry
	oldPublicKey    string
	oldFingerprint  string
	oldRef          SecretReference
	oldSeed         string
	recoveryDir     string
	// server state
	serverKey   atomic.Value // string: the key whoami reports
	rotateCalls atomic.Int32
	respond     func(w http.ResponseWriter, body map[string]string) // overrides success
	whoamiFails bool
	refreshed   []string
	client      *moltnetapi.Client
}

func newIdentityRotateFixture(t *testing.T) *identityRotateFixture {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f := &identityRotateFixture{
		credentialsPath: filepath.Join(t.TempDir(), "moltnet.json"),
		keyring:         &memorySecretProvider{values: map[string]string{}},
		oldPublicKey:    "ed25519:" + base64.StdEncoding.EncodeToString(public),
		oldFingerprint:  Fingerprint(public),
		oldSeed:         base64.StdEncoding.EncodeToString(private.Seed()),
		recoveryDir:     t.TempDir(),
	}
	f.oldRef = SecretReference{Provider: osKeyringProviderName, Key: IdentitySeedKey(f.oldFingerprint)}
	f.keyring.values[f.oldRef.Key] = f.oldSeed
	f.registry = NewSecretProviderRegistry()
	f.registry.Register(osKeyringProviderName, f.keyring)
	f.serverKey.Store(f.oldPublicKey)

	document := map[string]any{
		"subject_id":   rotateFixtureSubject,
		"subject_type": "agent",
		"oauth2":       map[string]any{"client_id": "cid"},
		"keys": map[string]any{
			"public_key":      f.oldPublicKey,
			"fingerprint":     f.oldFingerprint,
			"private_key_ref": f.oldRef,
			"extra":           "kept",
		},
		"endpoints": map[string]any{"api": "https://api.themolt.net", "mcp": "https://mcp.themolt.net/mcp"},
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.credentialsPath, data, privateFileMode); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(f.serve(t)))
	t.Cleanup(server.Close)
	f.client, err = newBearerClient(server.URL, func(context.Context) (string, error) { return "token", nil }, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// serve mirrors the REST API: it rebuilds the message from the raw issuedAt
// string it received and requires both signatures over it.
func (f *identityRotateFixture) serve(t *testing.T) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/agents/whoami":
			if f.whoamiFails {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"type":"about:blank","title":"Unavailable","status":503}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subjectId":   rotateFixtureSubject,
				"identityId":  "00000000-0000-4000-8000-0000000000aa",
				"subjectType": "agent",
				"scopes":      []string{},
				"publicKey":   f.serverKey.Load(),
			})
		case "/auth/rotate-identity-key":
			f.rotateCalls.Add(1)
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode rotation body: %v", err)
				return
			}
			if f.respond != nil {
				f.respond(w, body)
				return
			}
			message := buildIdentityKeyRotationMessage(rotateFixtureSubject, f.serverKey.Load().(string), body["newPublicKey"], body["issuedAt"])
			if !verifyBase64Signature(f.serverKey.Load().(string), message, body["previousKeySignature"]) ||
				!verifyBase64Signature(body["newPublicKey"], message, body["newKeySignature"]) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"type":"about:blank","title":"Invalid signature","status":400}`))
				return
			}
			newKey := body["newPublicKey"]
			f.serverKey.Store(newKey)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"agentId":             rotateFixtureSubject,
				"publicKey":           newKey,
				"fingerprint":         fingerprintOf(t, newKey),
				"previousFingerprint": f.oldFingerprint,
			})
		default:
			http.NotFound(w, r)
		}
	}
}

func verifyBase64Signature(publicKey, message, signature string) bool {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(publicKey, "ed25519:"))
	if err != nil || len(key) != ed25519.PublicKeySize {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(key), []byte(message), sig)
}

func fingerprintOf(t *testing.T, publicKey string) string {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(publicKey, "ed25519:"))
	if err != nil {
		t.Fatal(err)
	}
	return Fingerprint(ed25519.PublicKey(key))
}

func (f *identityRotateFixture) opts() identityKeyRotateOpts {
	return identityKeyRotateOpts{
		credentialsPath: f.credentialsPath,
		providers:       f.registry,
		client:          f.client,
		// A time with sub-second precision: the signed string must match the
		// whole-second RFC3339 form the generated client sends.
		now: func() time.Time { return time.Now().Add(123 * time.Millisecond) },
		refreshArtifacts: func(_ string, retired string) error {
			f.refreshed = append(f.refreshed, retired)
			return nil
		},
		writeRecovery: func(recovery identityKeyRotationRecovery) (string, error) {
			return writeRecoveryArtifact(f.recoveryDir, "identity-key-rotation-recovery-*.json", recovery)
		},
	}
}

func (f *identityRotateFixture) credentials(t *testing.T) *CredentialsFile {
	t.Helper()
	creds, err := ReadConfigFrom(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	return creds
}

func (f *identityRotateFixture) credentialsBytes(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// stagedSeeds returns every seed stored besides the original one.
func (f *identityRotateFixture) stagedSeeds() map[string]string {
	staged := map[string]string{}
	for key, value := range f.keyring.values {
		if key != f.oldRef.Key && value != "" {
			staged[key] = value
		}
	}
	return staged
}

func TestIdentityKeyRotateSwitchesToAVerifiedNewKey(t *testing.T) {
	f := newIdentityRotateFixture(t)
	var out, errOut bytes.Buffer

	if err := runAgentsIdentityKeyRotateCmd(context.Background(), &out, &errOut, f.opts()); err != nil {
		t.Fatalf("rotate: %v\n%s", err, errOut.String())
	}

	var result identityKeyRotateOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out.String())
	}
	serverKey := f.serverKey.Load().(string)
	if result.PublicKey != serverKey || result.PreviousFingerprint != f.oldFingerprint || !result.CredentialsUpdated || !result.ArtifactsRefreshed {
		t.Fatalf("unexpected result: %+v", result)
	}
	creds := f.credentials(t)
	wantRef := SecretReference{Provider: osKeyringProviderName, Key: IdentitySeedKey(result.Fingerprint)}
	if creds.Keys.PublicKey != serverKey || creds.Keys.Fingerprint != result.Fingerprint || *creds.Keys.PrivateKeyRef != wantRef {
		t.Fatalf("keys not switched: %+v", creds.Keys)
	}
	// The stored seed derives the key the server now holds.
	seed, err := resolveIdentitySeed(creds, f.registry)
	if err != nil {
		t.Fatalf("new seed does not resolve: %v", err)
	}
	if f.keyring.values[f.oldRef.Key] != f.oldSeed || result.RetiredSeedReference != f.oldRef {
		t.Fatal("the retired seed must be left in place and reported")
	}
	if len(f.refreshed) != 1 || f.refreshed[0] != f.oldPublicKey {
		t.Fatalf("artifacts not refreshed with the retired key: %v", f.refreshed)
	}
	for _, secret := range []string{seed, f.oldSeed} {
		if strings.Contains(out.String(), secret) || strings.Contains(errOut.String(), secret) {
			t.Fatal("a seed leaked into the output")
		}
	}
	var document struct {
		Keys struct {
			Extra string `json:"extra"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(f.credentialsBytes(t), &document); err != nil || document.Keys.Extra != "kept" {
		t.Fatalf("unrelated key fields were not preserved: %s", f.credentialsBytes(t))
	}
}

func TestIdentityKeyRotateDiscardsTheStagedSeedOnRejection(t *testing.T) {
	f := newIdentityRotateFixture(t)
	f.respond = func(w http.ResponseWriter, _ map[string]string) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"type":"about:blank","title":"Conflict","status":409}`))
	}
	before := f.credentialsBytes(t)

	err := runAgentsIdentityKeyRotateCmd(context.Background(), &bytes.Buffer{}, nil, f.opts())

	if err == nil || !strings.Contains(err.Error(), "nothing was changed") {
		t.Fatalf("expected a clean rejection, got %v", err)
	}
	if !bytes.Equal(before, f.credentialsBytes(t)) {
		t.Fatal("a rejected rotation rewrote the credentials file")
	}
	if staged := f.stagedSeeds(); len(staged) != 0 {
		t.Fatalf("the staged seed was not discarded: %v", staged)
	}
}

func TestIdentityKeyRotateResolvesAnUnknownOutcomeWithWhoami(t *testing.T) {
	serverError := func(committed bool, f *identityRotateFixture) func(http.ResponseWriter, map[string]string) {
		return func(w http.ResponseWriter, body map[string]string) {
			if committed {
				f.serverKey.Store(body["newPublicKey"])
			}
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"type":"about:blank","title":"Upstream","status":502}`))
		}
	}

	t.Run("the server rotated", func(t *testing.T) {
		f := newIdentityRotateFixture(t)
		f.respond = serverError(true, f)
		var errOut bytes.Buffer

		if err := runAgentsIdentityKeyRotateCmd(context.Background(), &bytes.Buffer{}, &errOut, f.opts()); err != nil {
			t.Fatalf("rotate: %v", err)
		}
		if f.credentials(t).Keys.PublicKey != f.serverKey.Load().(string) {
			t.Fatal("local keys do not follow the server's new key")
		}
		if !strings.Contains(errOut.String(), "server now uses the new key") {
			t.Fatalf("missing warning: %s", errOut.String())
		}
	})

	t.Run("the server kept the old key", func(t *testing.T) {
		f := newIdentityRotateFixture(t)
		f.respond = serverError(false, f)
		before := f.credentialsBytes(t)

		err := runAgentsIdentityKeyRotateCmd(context.Background(), &bytes.Buffer{}, nil, f.opts())

		if err == nil || !strings.Contains(err.Error(), "still uses the current key") {
			t.Fatalf("expected a clean failure, got %v", err)
		}
		if !bytes.Equal(before, f.credentialsBytes(t)) || len(f.stagedSeeds()) != 0 {
			t.Fatal("a failed rotation left local changes")
		}
	})

	t.Run("the outcome cannot be determined", func(t *testing.T) {
		f := newIdentityRotateFixture(t)
		f.respond = serverError(true, f)
		f.whoamiFails = true
		var out bytes.Buffer

		err := runAgentsIdentityKeyRotateCmd(context.Background(), &out, nil, f.opts())

		if err == nil || !strings.Contains(err.Error(), "manual recovery") {
			t.Fatalf("expected manual recovery, got %v", err)
		}
		staged := f.stagedSeeds()
		if len(staged) != 1 {
			t.Fatalf("the staged seed must be kept for recovery: %v", staged)
		}
		entries, _ := os.ReadDir(f.recoveryDir)
		if len(entries) != 1 {
			t.Fatalf("expected one recovery artifact, got %d", len(entries))
		}
		artifact, _ := os.ReadFile(filepath.Join(f.recoveryDir, entries[0].Name()))
		for _, seed := range staged {
			if strings.Contains(string(artifact), seed) || strings.Contains(out.String(), seed) {
				t.Fatal("the recovery artifact or output carries the seed")
			}
		}
	})
}

func TestIdentityKeyRotateRecoversWhenTheConfigChangedMeanwhile(t *testing.T) {
	f := newIdentityRotateFixture(t)
	// The server rotates, and another writer changes keys.* while the
	// request is in flight, so the local compare-and-swap must fail.
	f.respond = func(w http.ResponseWriter, body map[string]string) {
		f.serverKey.Store(body["newPublicKey"])
		creds, _ := ReadConfigFrom(f.credentialsPath)
		creds.Keys.PublicKey = "ed25519:someone-else"
		_, _ = WriteConfigTo(creds, f.credentialsPath)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":             rotateFixtureSubject,
			"publicKey":           body["newPublicKey"],
			"fingerprint":         fingerprintOf(t, body["newPublicKey"]),
			"previousFingerprint": f.oldFingerprint,
		})
	}

	err := runAgentsIdentityKeyRotateCmd(context.Background(), &bytes.Buffer{}, nil, f.opts())

	if err == nil || !strings.Contains(err.Error(), "update_credentials") {
		t.Fatalf("expected a credentials update failure, got %v", err)
	}
	if len(f.stagedSeeds()) != 1 {
		t.Fatal("the new seed must stay stored for recovery")
	}
}

func TestIdentityKeyRotateFailsBeforeContactingTheServer(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, f *identityRotateFixture)
		want  string
	}{
		{
			name: "unwritable seed provider",
			setup: func(t *testing.T, f *identityRotateFixture) {
				f.registry.Register(osKeyringProviderName, readOnlyMemoryProvider{f.keyring})
			},
			want: "not writable",
		},
		{
			name: "plaintext seed",
			setup: func(t *testing.T, f *identityRotateFixture) {
				creds, _ := ReadConfigFrom(f.credentialsPath)
				creds.Keys.PrivateKeyRef = nil
				creds.Keys.PrivateKey = f.oldSeed
				if _, err := WriteConfigTo(creds, f.credentialsPath); err != nil {
					t.Fatal(err)
				}
			},
			want: "config migrate",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newIdentityRotateFixture(t)
			tc.setup(t, f)

			err := runAgentsIdentityKeyRotateCmd(context.Background(), &bytes.Buffer{}, nil, f.opts())

			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
			if f.rotateCalls.Load() != 0 || len(f.stagedSeeds()) != 0 {
				t.Fatal("nothing may be staged or sent")
			}
		})
	}
}

type readOnlyMemoryProvider struct{ inner *memorySecretProvider }

func (p readOnlyMemoryProvider) Get(key string) (string, error) { return p.inner.Get(key) }
func (readOnlyMemoryProvider) Set(string, string) error         { return errors.New("read-only") }
func (readOnlyMemoryProvider) Delete(string) error              { return errors.New("read-only") }

func TestWriteRotatedAllowedSignersKeepsRetiredKeys(t *testing.T) {
	dir := t.TempDir()
	keys := make([]string, 3)
	for i := range keys {
		public, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		keys[i] = "ed25519:" + base64.StdEncoding.EncodeToString(public)
	}
	line := func(key string) string {
		l, err := allowedSignerLine("bot@example.com", key)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	if err := os.MkdirAll(filepath.Join(dir, "ssh"), 0o700); err != nil {
		t.Fatal(err)
	}
	// A previous rotation already left keys[0] behind keys[1].
	if err := os.WriteFile(allowedSignersPathFor(dir), []byte(line(keys[1])+"\n"+line(keys[0])+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := writeRotatedAllowedSigners(dir, "bot@example.com", keys[2], keys[1]); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(allowedSignersPathFor(dir))
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{line(keys[2]), line(keys[1]), line(keys[0])}, "\n") + "\n"
	if string(data) != want {
		t.Fatalf("allowed_signers =\n%s\nwant\n%s", data, want)
	}
}

func TestIdentityKeyRotationRequestEncodesTheSignedTimestamp(t *testing.T) {
	issued := time.Date(2026, 9, 27, 10, 0, 0, 987654321, time.FixedZone("CEST", 2*3600)).UTC().Truncate(time.Second)
	request := moltnetapi.RotateIdentityKeyRequest{IssuedAt: issued, NewPublicKey: "k", PreviousKeySignature: "a", NewKeySignature: "b"}

	encoded, err := json.Marshal(&request)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]string
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	if body["issuedAt"] != issued.Format(identityKeyRotationTimeFormat) || body["issuedAt"] != "2026-09-27T08:00:00Z" {
		t.Fatalf("issuedAt encoded as %q", body["issuedAt"])
	}
}
