//go:build e2e

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

var (
	e2eAPIURL  string
	e2eCreds   *CredentialsFile
	e2eDiaryID uuid.UUID
	e2eClient  *moltnetapi.Client
)

// bootstrapAgent holds one element from the JSON array output of `pnpm bootstrap`.
type bootstrapAgent struct {
	Name         string `json:"name"`
	IdentityID   string `json:"identityId"`
	Fingerprint  string `json:"fingerprint"`
	PublicKey    string `json:"publicKey"`
	PrivateKey   string `json:"privateKey"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	AccessToken  string `json:"accessToken"`
}

func TestMain(m *testing.M) {
	e2eAPIURL = os.Getenv("API_URL")
	if e2eAPIURL == "" {
		e2eAPIURL = "http://localhost:8080"
	}

	// Poll health endpoint until ready
	if err := waitForHealth(e2eAPIURL+"/health", 60*time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "E2E setup: API not ready: %v\n", err)
		os.Exit(1)
	}

	// Bootstrap a genesis agent (bypasses voucher system)
	agent, err := bootstrapGenesisAgent()
	if err != nil {
		fmt.Fprintf(os.Stderr, "E2E setup: bootstrap failed: %v\n", err)
		os.Exit(1)
	}

	e2eCreds = &CredentialsFile{
		IdentityID: agent.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     agent.ClientID,
			ClientSecret: agent.ClientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:   agent.PublicKey,
			PrivateKey:  agent.PrivateKey,
			Fingerprint: agent.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{
			API: e2eAPIURL,
		},
	}

	// Create authenticated client
	tm := NewTokenManager(e2eAPIURL, e2eCreds.OAuth2.ClientID, e2eCreds.OAuth2.ClientSecret)
	e2eClient, err = newAuthedClient(e2eAPIURL, tm)
	if err != nil {
		fmt.Fprintf(os.Stderr, "E2E setup: create client: %v\n", err)
		os.Exit(1)
	}

	// Find personal team
	teamsRes, err := e2eClient.ListTeams(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "E2E setup: list teams: %v\n", err)
		os.Exit(1)
	}
	teamsList, ok := teamsRes.(*moltnetapi.ListTeamsOK)
	if !ok {
		fmt.Fprintf(os.Stderr, "E2E setup: unexpected teams response type: %T\n", teamsRes)
		os.Exit(1)
	}
	var personalTeamID string
	for _, t := range teamsList.Items {
		if t.Personal {
			personalTeamID = t.ID.String()
			break
		}
	}
	if personalTeamID == "" {
		fmt.Fprintf(os.Stderr, "E2E setup: no personal team found\n")
		os.Exit(1)
	}

	// Create a test diary
	diaryRes, err := e2eClient.CreateDiary(context.Background(), &moltnetapi.CreateDiaryReq{
		Name: "e2e-go-cli-" + uuid.New().String()[:8],
	}, moltnetapi.CreateDiaryParams{XMoltnetTeamID: uuid.MustParse(personalTeamID)})
	if err != nil {
		fmt.Fprintf(os.Stderr, "E2E setup: create diary: %v\n", err)
		os.Exit(1)
	}
	diary, ok := diaryRes.(*moltnetapi.DiaryCatalog)
	if !ok {
		fmt.Fprintf(os.Stderr, "E2E setup: unexpected diary response type: %T\n", diaryRes)
		os.Exit(1)
	}
	e2eDiaryID = diary.ID
	fmt.Fprintf(os.Stderr, "E2E: test diary created: %s\n", e2eDiaryID)

	code := m.Run()
	os.Exit(code)
}

// bootstrapGenesisAgent runs `pnpm bootstrap --count 1` and parses the output.
// This creates a genesis agent that bypasses the voucher system entirely.
func bootstrapGenesisAgent() (*bootstrapAgent, error) {
	repoRoot := os.Getenv("REPO_ROOT")
	if repoRoot == "" {
		// Try to find repo root from git
		out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
		if err != nil {
			return nil, fmt.Errorf("cannot determine repo root: %w", err)
		}
		repoRoot = string(out[:len(out)-1]) // trim newline
	}

	// Set required env vars for split Ory deployment (docker-compose e2e).
	// Use env vars if already set (CI), otherwise default to docker-compose port mappings.
	dbURL := envOrDefault("DATABASE_URL", "postgresql://moltnet:moltnet_secret@localhost:5433/moltnet")
	env := append(os.Environ(),
		"DATABASE_URL="+dbURL,
		"ORY_KRATOS_ADMIN_URL="+envOrDefault("ORY_KRATOS_ADMIN_URL", "http://localhost:4434"),
		"ORY_HYDRA_ADMIN_URL="+envOrDefault("ORY_HYDRA_ADMIN_URL", "http://localhost:4445"),
		"ORY_HYDRA_PUBLIC_URL="+envOrDefault("ORY_HYDRA_PUBLIC_URL", "http://localhost:4444"),
		"ORY_KETO_READ_URL="+envOrDefault("ORY_KETO_READ_URL", "http://localhost:4466"),
		"ORY_KETO_WRITE_URL="+envOrDefault("ORY_KETO_WRITE_URL", "http://localhost:4467"),
	)

	cmd := exec.Command("pnpm", "bootstrap", "--count", "1")
	cmd.Dir = repoRoot
	cmd.Env = env
	cmd.Stderr = os.Stderr

	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("pnpm bootstrap: %w", err)
	}

	// pnpm wraps output with script headers; extract the JSON array.
	jsonStart := bytes.IndexByte(out, '[')
	jsonEnd := bytes.LastIndexByte(out, ']')
	if jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart {
		return nil, fmt.Errorf("no JSON array in bootstrap output: %s", string(out))
	}
	jsonData := out[jsonStart : jsonEnd+1]

	var agents []bootstrapAgent
	if err := json.Unmarshal(jsonData, &agents); err != nil {
		return nil, fmt.Errorf("parse bootstrap output: %w (raw: %s)", err, string(jsonData))
	}
	if len(agents) == 0 {
		return nil, fmt.Errorf("bootstrap returned no agents")
	}
	fmt.Fprintf(os.Stderr, "E2E: bootstrapped genesis agent: %s (fingerprint: %s)\n",
		agents[0].Name, agents[0].Fingerprint)
	return &agents[0], nil
}

func waitForHealth(url string, timeout time.Duration) error {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := httpClient.Get(url)
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			return nil
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(1 * time.Second)
	}
	return fmt.Errorf("health check at %s timed out after %s", url, timeout)
}

func TestE2E_DiaryCommit_Unsigned(t *testing.T) {
	result, err := signAndCreateEntry(
		e2eClient,
		e2eCreds,
		"<content>\nE2E test unsigned commit\n</content>\n<metadata>\nsigner: "+e2eCreds.Keys.Fingerprint+"\n</metadata>",
		e2eDiaryID,
		"E2E test: unsigned commit",
		[]string{"accountable-commit", "risk:low", "e2e-test"},
		2,
		false,
	)
	if err != nil {
		t.Fatalf("signAndCreateEntry (unsigned): %v", err)
	}
	if result.EntryID == "" {
		t.Error("expected non-empty entryId")
	}
	if result.Signature == "" {
		t.Error("expected non-empty signature")
	}

	// Verify entry exists
	entryUUID, err := uuid.Parse(result.EntryID)
	if err != nil {
		t.Fatalf("parse entry ID: %v", err)
	}
	getRes, err := e2eClient.GetDiaryEntryById(context.Background(), moltnetapi.GetDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		t.Fatalf("get entry: %v", err)
	}
	entry, ok := getRes.(*moltnetapi.DiaryEntry)
	if !ok {
		t.Fatalf("unexpected response type: %T", getRes)
	}
	if entry.ID != entryUUID {
		t.Errorf("entry ID mismatch: got %s, want %s", entry.ID, entryUUID)
	}
	t.Logf("Unsigned entry verified: %s", entry.ID)
}

func TestE2E_DiaryCommit_Signed(t *testing.T) {
	result, err := signAndCreateEntry(
		e2eClient,
		e2eCreds,
		"<content>\nE2E test signed commit\n</content>\n<metadata>\nsigner: "+e2eCreds.Keys.Fingerprint+"\n</metadata>",
		e2eDiaryID,
		"E2E test: signed commit",
		[]string{"accountable-commit", "risk:medium", "e2e-test"},
		5,
		true,
	)
	if err != nil {
		t.Fatalf("signAndCreateEntry (signed): %v", err)
	}
	if result.EntryID == "" {
		t.Error("expected non-empty entryId")
	}
	if result.Signature == "" {
		t.Error("expected non-empty signature")
	}

	// Verify via the verify endpoint
	entryUUID, err := uuid.Parse(result.EntryID)
	if err != nil {
		t.Fatalf("parse entry ID: %v", err)
	}

	verifyRes, err := e2eClient.VerifyDiaryEntryById(context.Background(), moltnetapi.VerifyDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		t.Fatalf("verify entry: %v", err)
	}
	verifyResult, ok := verifyRes.(*moltnetapi.EntryVerifyResult)
	if !ok {
		t.Fatalf("unexpected verify response type: %T", verifyRes)
	}

	if !verifyResult.Valid {
		data, _ := json.MarshalIndent(verifyResult, "", "  ")
		t.Fatalf("expected valid=true, got: %s", string(data))
	}
	if !verifyResult.Signed {
		t.Error("expected signed=true")
	}
	if !verifyResult.HashMatches {
		t.Error("expected hashMatches=true")
	}
	if !verifyResult.SignatureValid {
		t.Error("expected signatureValid=true")
	}
	t.Logf("Signed entry verified: %s (CID: %s)", entryUUID, verifyResult.ContentHash.Value)
}

func TestE2E_Sign_RequestID(t *testing.T) {
	sigRes, err := e2eClient.CreateSigningRequest(context.Background(), &moltnetapi.CreateSigningRequestReq{Message: "e2e test message"})
	if err != nil {
		t.Fatalf("create signing request: %v", err)
	}
	sigReq, ok := sigRes.(*moltnetapi.SigningRequest)
	if !ok {
		t.Fatalf("unexpected type: %T", sigRes)
	}

	sig, err := signWithRequestID(e2eClient, sigReq.ID.String(), e2eCreds.Keys.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if sig == "" {
		t.Error("expected non-empty signature")
	}
	t.Logf("Signing request %s completed", sigReq.ID)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
