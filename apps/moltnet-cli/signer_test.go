package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func sshString(b []byte) []byte {
	out := make([]byte, 4+len(b))
	out[0], out[1], out[2], out[3] = byte(len(b)>>24), byte(len(b)>>16), byte(len(b)>>8), byte(len(b))
	copy(out[4:], b)
	return out
}

// gitSshsigEnvelope builds the blob ssh-keygen -Y sign -n git asks to sign.
func gitSshsigEnvelope() []byte {
	out := []byte("SSHSIG")
	out = append(out, sshString([]byte("git"))...)
	out = append(out, sshString(nil)...)
	out = append(out, sshString([]byte("sha512"))...)
	out = append(out, sshString(make([]byte, 64))...)
	return out
}

type fakeBroker struct {
	srv       *httptest.Server
	identity  SignerIdentity
	gitCalls  [][]byte
	diaryIDs  []string
	gitStatus int
	gitCode   string
	priv      ed25519.PrivateKey
}

func newFakeBroker(t *testing.T) *fakeBroker {
	t.Helper()
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	seed, _ := base64.StdEncoding.DecodeString(kp.PrivateKey)
	b := &fakeBroker{
		identity: SignerIdentity{
			AgentName: "legreffier", IdentityID: "id-1", PublicKey: kp.PublicKey,
			Fingerprint: kp.Fingerprint, GitName: "LeGreffier", GitEmail: "l@x",
		},
		gitStatus: http.StatusOK,
		priv:      ed25519.NewKeyFromSeed(seed),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/identity", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(b.identity)
	})
	mux.HandleFunc("/sign-git-commit", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Sshsig string `json:"sshsig"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		raw, _ := base64.StdEncoding.DecodeString(body.Sshsig)
		b.gitCalls = append(b.gitCalls, raw)
		if b.gitStatus != http.StatusOK {
			w.WriteHeader(b.gitStatus)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": b.gitCode, "message": "denied: secret-hint"})
			return
		}
		sig := ed25519.Sign(b.priv, raw)
		_ = json.NewEncoder(w).Encode(map[string]string{"signature": base64.StdEncoding.EncodeToString(sig)})
	})
	mux.HandleFunc("/sign-diary-entry", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SigningRequestID string `json:"signingRequestId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		b.diaryIDs = append(b.diaryIDs, body.SigningRequestID)
		_ = json.NewEncoder(w).Encode(body)
	})
	b.srv = httptest.NewServer(mux)
	t.Cleanup(b.srv.Close)
	return b
}

func TestResolveSignerPrefersRemoteWhenSignerURLSet(t *testing.T) {
	b := newFakeBroker(t)
	t.Setenv(signerURLEnv, b.srv.URL)
	signer, err := resolveSigner("")
	if err != nil {
		t.Fatalf("resolveSigner: %v", err)
	}
	id, err := signer.Identity(context.Background())
	if err != nil {
		t.Fatalf("Identity: %v", err)
	}
	if id.Fingerprint != b.identity.Fingerprint || id.GitEmail != "l@x" {
		t.Fatalf("unexpected identity %+v", id)
	}
}

func TestResolveSignerRejectsPlaintextNonLoopbackURL(t *testing.T) {
	t.Setenv(signerURLEnv, "http://signer.example.com")
	if _, err := resolveSigner(""); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("expected https error, got %v", err)
	}
}

func TestResolveSignerFallsBackToLocalSeed(t *testing.T) {
	t.Setenv(signerURLEnv, "")
	kp, _ := GenerateKeyPair()
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{IdentityID: "x", Keys: CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey, Fingerprint: kp.Fingerprint}}, credPath); err != nil {
		t.Fatal(err)
	}
	signer, err := resolveSigner(credPath)
	if err != nil {
		t.Fatalf("resolveSigner: %v", err)
	}
	id, _ := signer.Identity(context.Background())
	if id.Fingerprint != kp.Fingerprint {
		t.Fatalf("unexpected identity %+v", id)
	}
}

func TestRemoteSignerSignsGitEnvelopeAndSurfacesErrorCode(t *testing.T) {
	b := newFakeBroker(t)
	signer, err := newRemoteSigner(b.srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	envelope := gitSshsigEnvelope()
	sig, err := signer.SignGitCommit(context.Background(), envelope)
	if err != nil {
		t.Fatalf("SignGitCommit: %v", err)
	}
	pub, _ := ParsePublicKey(b.identity.PublicKey)
	if !ed25519.Verify(pub, envelope, sig) {
		t.Fatal("signature does not verify")
	}
	if !bytes.Equal(b.gitCalls[0], envelope) {
		t.Fatal("broker did not receive the envelope")
	}

	b.gitStatus, b.gitCode = http.StatusForbidden, "host_capability_denied"
	_, err = signer.SignGitCommit(context.Background(), envelope)
	if err == nil || !strings.Contains(err.Error(), "host_capability_denied") || strings.Contains(err.Error(), "secret-hint") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestEntryCreateSignedUsesRemoteSigner(t *testing.T) {
	b := newFakeBroker(t)
	t.Setenv(signerURLEnv, b.srv.URL)
	t.Setenv(agentKeyEnv, "agent-key-secret")

	reqID := uuid.MustParse("00000000-0000-0000-0000-000000000077")
	handler := &stubSignedEntryHandler{requestID: reqID}
	generated, err := moltnetapi.NewServer(handler, noopSecurityHandler{})
	if err != nil {
		t.Fatal(err)
	}
	apiSrv := httptest.NewServer(generated)
	defer apiSrv.Close()

	// No credentials file at all: the guest holds no key material.
	err = runEntryCreateSignedCmd(apiSrv.URL, filepath.Join(t.TempDir(), "missing.json"),
		"11111111-1111-4111-8111-111111111111", "content", "title", "semantic", "a,b", 0, false)
	if err != nil {
		t.Fatalf("runEntryCreateSignedCmd: %v", err)
	}
	if len(b.diaryIDs) != 1 || b.diaryIDs[0] != reqID.String() {
		t.Fatalf("broker did not sign the request: %v", b.diaryIDs)
	}
	if handler.createdWith != reqID {
		t.Fatalf("entry not linked to signing request: %s", handler.createdWith)
	}
	if handler.submitted {
		t.Fatal("guest must not submit signatures itself under a remote signer")
	}
}

// stubSignedEntryHandler serves the minimal API the create-signed flow needs.
type stubSignedEntryHandler struct {
	moltnetapi.UnimplementedHandler
	requestID      uuid.UUID
	createdWith    uuid.UUID
	createdContent string
	submitted      bool
}

func (h *stubSignedEntryHandler) CreateSigningRequest(_ context.Context, req *moltnetapi.CreateSigningRequestReq) (moltnetapi.CreateSigningRequestRes, error) {
	return &moltnetapi.SigningRequest{ID: h.requestID, Message: req.Message, Status: moltnetapi.SigningRequestStatusPending,
		VerificationMethod: moltnetapi.SigningRequestVerificationMethodAgentEd25519, AgentId: uuid.New()}, nil
}

func (h *stubSignedEntryHandler) GetSigningRequest(_ context.Context, params moltnetapi.GetSigningRequestParams) (moltnetapi.GetSigningRequestRes, error) {
	return &moltnetapi.SigningRequest{ID: params.ID, Status: moltnetapi.SigningRequestStatusCompleted,
		VerificationMethod: moltnetapi.SigningRequestVerificationMethodAgentEd25519, AgentId: uuid.New(),
		Signature: moltnetapi.NewNilString("c2ln")}, nil
}

func (h *stubSignedEntryHandler) SubmitSignature(_ context.Context, _ *moltnetapi.SubmitSignatureReq, params moltnetapi.SubmitSignatureParams) (moltnetapi.SubmitSignatureRes, error) {
	h.submitted = true
	return &moltnetapi.SigningRequest{ID: params.ID}, nil
}

func (h *stubSignedEntryHandler) CreateDiaryEntry(_ context.Context, req *moltnetapi.CreateDiaryEntryReq, _ moltnetapi.CreateDiaryEntryParams) (moltnetapi.CreateDiaryEntryRes, error) {
	h.createdWith = req.SigningRequestId.Value
	h.createdContent = req.Content
	creator := moltnetapi.DiaryEntryCreator{Type: moltnetapi.AgentPrincipalDiaryEntryCreator}
	creator.SetAgentPrincipal(testAgentPrincipal())
	return &moltnetapi.DiaryEntry{
		ID:         uuid.New(),
		DiaryId:    uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		Creator:    creator,
		Content:    req.Content,
		EntryType:  moltnetapi.DiaryEntryEntryTypeSemantic,
		Importance: 5,
	}, nil
}

func TestEntryCommitUsesRemoteSignerIdentity(t *testing.T) {
	b := newFakeBroker(t)
	t.Setenv(signerURLEnv, b.srv.URL)
	t.Setenv(agentKeyEnv, "agent-key-secret")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(t.TempDir(), "empty-gitconfig"))

	repo := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	run("-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "init")
	if err := os.WriteFile(filepath.Join(repo, "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "f.txt")
	oldWd, _ := os.Getwd()
	if err := os.Chdir(repo); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWd) })

	reqID := uuid.MustParse("00000000-0000-0000-0000-000000000078")
	handler := &stubSignedEntryHandler{requestID: reqID}
	generated, err := moltnetapi.NewServer(handler, noopSecurityHandler{})
	if err != nil {
		t.Fatal(err)
	}
	apiSrv := httptest.NewServer(generated)
	defer apiSrv.Close()

	var out bytes.Buffer
	err = runEntryCommitCmd(&out, apiSrv.URL, filepath.Join(t.TempDir(), "missing.json"),
		"11111111-1111-4111-8111-111111111111", "remote signer commit rationale", "low", "cli", "edouard", "claude", "", true, 0, "")
	if err != nil {
		t.Fatalf("runEntryCommitCmd: %v", err)
	}
	if !strings.Contains(handler.createdContent, "signer: "+b.identity.Fingerprint) {
		t.Fatalf("payload did not carry the remote identity fingerprint:\n%s", handler.createdContent)
	}
	if len(b.diaryIDs) != 1 || handler.submitted {
		t.Fatalf("expected exactly one brokered signature and no local submission (broker=%v submitted=%v)", b.diaryIDs, handler.submitted)
	}
}

func TestSSHKeyExportWritesPublicKeyOnlyUnderRemoteSigner(t *testing.T) {
	b := newFakeBroker(t)
	t.Setenv(signerURLEnv, b.srv.URL)
	kp, _ := GenerateKeyPair()
	dir := t.TempDir()
	credPath := filepath.Join(dir, "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{IdentityID: "x", Keys: CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey, Fingerprint: kp.Fingerprint}}, credPath); err != nil {
		t.Fatal(err)
	}
	if err := runSSHKeyExportCmd(credPath, filepath.Join(dir, "ssh")); err != nil {
		t.Fatalf("runSSHKeyExportCmd: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "ssh", "id_ed25519")); !os.IsNotExist(err) {
		t.Fatal("private key must not be written under a remote signer")
	}
	if _, err := os.Stat(filepath.Join(dir, "ssh", "id_ed25519.pub")); err != nil {
		t.Fatal("public key must be written")
	}
	creds, _ := ReadConfigFrom(credPath)
	if creds.SSH == nil || creds.SSH.PrivateKeyPath != "" || creds.SSH.PublicKeyPath == "" {
		t.Fatalf("unexpected ssh section %+v", creds.SSH)
	}
}

func TestConfigExportEnvOmitsSeedUnderRemoteSigner(t *testing.T) {
	t.Setenv(signerURLEnv, "https://agent-signing.moltnet.internal")
	kp, _ := GenerateKeyPair()
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{IdentityID: "x", OAuth2: CredentialsOAuth2{ClientID: "c", ClientSecret: "s"}, Keys: CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey, Fingerprint: kp.Fingerprint}}, credPath); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := runConfigExportEnvCmd(&out, credPath, "", false, true); err != nil {
		t.Fatalf("runConfigExportEnvCmd: %v", err)
	}
	if strings.Contains(out.String(), "MOLTNET_PRIVATE_KEY=") || strings.Contains(out.String(), kp.PrivateKey) {
		t.Fatalf("seed exported under a remote signer:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "MOLTNET_PUBLIC_KEY=") {
		t.Fatal("public key should still be exported")
	}
}

func TestSignNonceModeIsRefusedUnderRemoteSigner(t *testing.T) {
	b := newFakeBroker(t)
	t.Setenv(signerURLEnv, b.srv.URL)
	var out bytes.Buffer
	err := runSignCmd(&out, "", "https://api.example.test", "5a0e4c4e-4d5e-4c5e-8b5e-5e5e5e5e5e5e", "", []string{"payload"})
	if err == nil || !strings.Contains(err.Error(), "--request-id") {
		t.Fatalf("expected nonce mode refusal, got %v", err)
	}
}
