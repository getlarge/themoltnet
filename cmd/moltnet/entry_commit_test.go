package main

import (
	"context"
	"encoding/base64"
	"reflect"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

func TestParseGitDiffStat(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
		wantRefs  []string
	}{
		{
			name:      "empty",
			input:     "",
			wantCount: 0,
			wantRefs:  nil,
		},
		{
			name:      "single file",
			input:     " src/main.go | 10 ++++------\n 1 file changed, 4 insertions(+), 6 deletions(-)",
			wantCount: 1,
			wantRefs:  []string{"src/main.go"},
		},
		{
			name: "multiple files",
			input: ` cmd/moltnet/diary.go    | 5 +++--
 cmd/moltnet/main.go    | 2 +-
 cmd/moltnet/api.go     | 8 ++++++++
 3 files changed, 10 insertions(+), 5 deletions(-)`,
			wantCount: 3,
			wantRefs:  []string{"cmd/moltnet/diary.go", "cmd/moltnet/main.go", "cmd/moltnet/api.go"},
		},
		{
			name: "more than 5 files truncates refs",
			input: ` a.go | 1 +
 b.go | 1 +
 c.go | 1 +
 d.go | 1 +
 e.go | 1 +
 f.go | 1 +
 g.go | 1 +
 7 files changed, 7 insertions(+)`,
			wantCount: 7,
			wantRefs:  []string{"a.go", "b.go", "c.go", "d.go", "e.go"},
		},
		{
			name:      "binary files",
			input:     " icon.png | Bin 0 -> 1234 bytes\n 1 file changed, 0 insertions(+), 0 deletions(-)",
			wantCount: 1,
			wantRefs:  []string{"icon.png"},
		},
		{
			name:      "rename",
			input:     " old.go => new.go | 0\n 1 file changed, 0 insertions(+), 0 deletions(-)",
			wantCount: 1,
			wantRefs:  []string{"old.go => new.go"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count, refs := parseGitDiffStat(tt.input)
			if count != tt.wantCount {
				t.Errorf("count = %d, want %d", count, tt.wantCount)
			}
			if !reflect.DeepEqual(refs, tt.wantRefs) {
				t.Errorf("refs = %v, want %v", refs, tt.wantRefs)
			}
		})
	}
}

func TestBuildCommitPayload(t *testing.T) {
	// Arrange
	origNowUTC := nowUTC
	nowUTC = func() string { return "2026-03-17T12:00:00Z" }
	t.Cleanup(func() { nowUTC = origNowUTC })

	meta := &gitMeta{
		Branch:       "feat/test",
		FilesChanged: 3,
		Refs:         []string{"a.go", "b.go", "c.go"},
	}

	// Act
	payload := buildCommitPayload("Test rationale.", meta, "FP-1234", "edouard", "claude", "low", []string{"auth", "api"})

	// Assert
	want := `<content>
Test rationale.
</content>
<metadata>
signer: FP-1234
operator: edouard
tool: claude
risk-level: low
files-changed: 3
refs: a.go, b.go, c.go
timestamp: 2026-03-17T12:00:00Z
branch: feat/test
scope: auth, api
</metadata>`

	if payload != want {
		t.Errorf("payload mismatch:\ngot:\n%s\n\nwant:\n%s", payload, want)
	}
}

func TestBuildCommitTags(t *testing.T) {
	tests := []struct {
		name      string
		risk      string
		branch    string
		scopes    []string
		extraTags []string
		want      []string
	}{
		{
			name:   "basic",
			risk:   "low",
			branch: "main",
			scopes: []string{"auth"},
			want:   []string{"accountable-commit", "risk:low", "branch:main", "scope:auth"},
		},
		{
			name:      "with extra tags",
			risk:      "high",
			branch:    "feat/x",
			scopes:    []string{"api", "db"},
			extraTags: []string{"urgent", "hotfix"},
			want:      []string{"accountable-commit", "risk:high", "branch:feat/x", "scope:api", "scope:db", "urgent", "hotfix"},
		},
		{
			name:   "no scopes",
			risk:   "medium",
			branch: "dev",
			scopes: nil,
			want:   []string{"accountable-commit", "risk:medium", "branch:dev"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildCommitTags(tt.risk, tt.branch, tt.scopes, tt.extraTags)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDeriveImportance(t *testing.T) {
	tests := []struct {
		risk string
		want int
	}{
		{"low", 2},
		{"medium", 5},
		{"high", 8},
		{"unknown", 5},
	}

	for _, tt := range tests {
		t.Run(tt.risk, func(t *testing.T) {
			if got := deriveImportance(tt.risk); got != tt.want {
				t.Errorf("deriveImportance(%q) = %d, want %d", tt.risk, got, tt.want)
			}
		})
	}
}

func TestFirstSentence(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"with period", "First sentence. Second sentence.", "First sentence."},
		{"no period short", "Short text", "Short text"},
		{"no period long", "This is a very long text without any period that goes on and on and on for quite a while indeed", "This is a very long text without any period that goes on and on and on for quite"},
		{"empty", "", ""},
		{"period at start", ".Rest", "."},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := firstSentence(tt.input); got != tt.want {
				t.Errorf("firstSentence(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidateCommitFlags_MissingRequired(t *testing.T) {
	validID := "00000000-0000-0000-0000-000000000001"

	tests := []struct {
		name      string
		diaryID   string
		rationale string
		risk      string
		scope     string
		operator  string
		tool      string
		wantErr   string
	}{
		{"missing diary-id", "", "text", "low", "auth", "ed", "claude", "flag --diary-id is required"},
		{"missing rationale", validID, "", "low", "auth", "ed", "claude", "flag --rationale is required"},
		{"missing risk", validID, "text", "", "auth", "ed", "claude", "flag --risk is required"},
		{"missing scope", validID, "text", "low", "", "ed", "claude", "flag --scope is required"},
		{"missing operator", validID, "text", "low", "auth", "", "claude", "flag --operator is required"},
		{"missing tool", validID, "text", "low", "auth", "ed", "", "flag --tool is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateCommitFlags(tt.diaryID, tt.rationale, tt.risk, tt.scope, tt.operator, tt.tool, 0)
			if err == nil {
				t.Fatal("expected error")
			}
			if err.Error() != tt.wantErr {
				t.Errorf("got %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestValidateCommitFlags_InvalidRisk(t *testing.T) {
	err := validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "critical", "auth", "ed", "claude", 0)
	if err == nil {
		t.Fatal("expected error for invalid risk")
	}
	if got := err.Error(); got != `invalid risk "critical": must be low, medium, or high` {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestValidateCommitFlags_InvalidDiaryId(t *testing.T) {
	err := validateCommitFlags("not-a-uuid", "text", "low", "auth", "ed", "claude", 0)
	if err == nil {
		t.Fatal("expected error for invalid diary ID")
	}
}

func TestValidateCommitFlags_InvalidImportance(t *testing.T) {
	for _, imp := range []int{-1, 11, 100} {
		err := validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "low", "auth", "ed", "claude", imp)
		if err == nil {
			t.Errorf("expected error for importance=%d", imp)
		}
	}
}

func TestValidateCommitFlags_ValidImportance(t *testing.T) {
	for _, imp := range []int{0, 1, 5, 10} {
		err := validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "low", "auth", "ed", "claude", imp)
		if err != nil {
			t.Errorf("unexpected error for importance=%d: %v", imp, err)
		}
	}
}

// stubCommitHandler implements the API operations needed by signAndCreateEntry.
type stubCommitHandler struct {
	moltnetapi.UnimplementedHandler
	signingRequestID uuid.UUID
	nonce            uuid.UUID
	gotCreateReq     *moltnetapi.CreateDiaryEntryReq
}

func (h *stubCommitHandler) CreateSigningRequest(_ context.Context, req *moltnetapi.CreateSigningRequestReq) (moltnetapi.CreateSigningRequestRes, error) {
	signingBytes := BuildSigningBytes(req.Message, h.nonce.String())
	signingInput := base64.StdEncoding.EncodeToString(signingBytes)
	return &moltnetapi.SigningRequest{
		ID:           h.signingRequestID,
		Message:      req.Message,
		Nonce:        h.nonce,
		SigningInput: signingInput,
		Status:       moltnetapi.SigningRequestStatusPending,
		AgentId:      uuid.New(),
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	}, nil
}

func (h *stubCommitHandler) GetSigningRequest(_ context.Context, params moltnetapi.GetSigningRequestParams) (moltnetapi.GetSigningRequestRes, error) {
	// Re-use the same message for the signing request lookup
	signingBytes := BuildSigningBytes("stub-message", h.nonce.String())
	signingInput := base64.StdEncoding.EncodeToString(signingBytes)
	return &moltnetapi.SigningRequest{
		ID:           params.ID,
		Message:      "stub-message",
		Nonce:        h.nonce,
		SigningInput: signingInput,
		Status:       moltnetapi.SigningRequestStatusPending,
		AgentId:      uuid.New(),
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	}, nil
}

func (h *stubCommitHandler) SubmitSignature(_ context.Context, req *moltnetapi.SubmitSignatureReq, params moltnetapi.SubmitSignatureParams) (moltnetapi.SubmitSignatureRes, error) {
	return &moltnetapi.SigningRequest{
		ID:        params.ID,
		Message:   "stub-message",
		Nonce:     h.nonce,
		Status:    moltnetapi.SigningRequestStatusCompleted,
		AgentId:   uuid.New(),
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}, nil
}

func (h *stubCommitHandler) CreateDiaryEntry(_ context.Context, req *moltnetapi.CreateDiaryEntryReq, _ moltnetapi.CreateDiaryEntryParams) (moltnetapi.CreateDiaryEntryRes, error) {
	h.gotCreateReq = req
	return &moltnetapi.DiaryEntry{
		ID:         uuid.MustParse("00000000-0000-0000-0000-000000000099"),
		DiaryId:    testDiaryID,
		Content:    req.Content,
		EntryType:  moltnetapi.DiaryEntryEntryTypeProcedural,
		Importance: 5,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		Tags:       req.Tags,
	}, nil
}

func TestSignAndCreateEntry_Unsigned(t *testing.T) {
	// Arrange
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	handler := &stubCommitHandler{
		signingRequestID: uuid.MustParse("00000000-0000-0000-0000-aaaaaaaaaaaa"),
		nonce:            uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000000"),
	}
	_, _, client := newTestServer(t, handler)

	creds := &CredentialsFile{
		Keys: CredentialsKeys{
			PrivateKey:  kp.PrivateKey,
			Fingerprint: "TEST-FP",
		},
	}

	// Act
	result, err := signAndCreateEntry(client, creds, "test payload", testDiaryID, "Test Title", []string{"tag1"}, 5, false)

	// Assert
	if err != nil {
		t.Fatalf("signAndCreateEntry() error: %v", err)
	}
	if result.EntryID == "" {
		t.Error("expected non-empty entryId")
	}
	if result.Signature == "" {
		t.Error("expected non-empty signature")
	}
	// Verify unsigned: no signingRequestId or contentHash on the create request
	if handler.gotCreateReq == nil {
		t.Fatal("expected CreateDiaryEntry to be called")
	}
	if handler.gotCreateReq.SigningRequestId.Set {
		t.Error("unsigned mode should not set signingRequestId")
	}
	if handler.gotCreateReq.ContentHash.Set {
		t.Error("unsigned mode should not set contentHash")
	}
}

func TestSignAndCreateEntry_Signed(t *testing.T) {
	// Arrange
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	handler := &stubCommitHandler{
		signingRequestID: uuid.MustParse("00000000-0000-0000-0000-aaaaaaaaaaaa"),
		nonce:            uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000000"),
	}
	_, _, client := newTestServer(t, handler)

	creds := &CredentialsFile{
		Keys: CredentialsKeys{
			PrivateKey:  kp.PrivateKey,
			Fingerprint: "TEST-FP",
		},
	}

	// Act
	result, err := signAndCreateEntry(client, creds, "test payload", testDiaryID, "Test Title", []string{"tag1"}, 5, true)

	// Assert
	if err != nil {
		t.Fatalf("signAndCreateEntry() error: %v", err)
	}
	if result.EntryID == "" {
		t.Error("expected non-empty entryId")
	}
	if result.Signature == "" {
		t.Error("expected non-empty signature")
	}
	// Verify signed: signingRequestId and contentHash should be set
	if handler.gotCreateReq == nil {
		t.Fatal("expected CreateDiaryEntry to be called")
	}
	if !handler.gotCreateReq.SigningRequestId.Set {
		t.Error("signed mode should set signingRequestId")
	}
	if !handler.gotCreateReq.ContentHash.Set {
		t.Error("signed mode should set contentHash")
	}
	if handler.gotCreateReq.ContentHash.Value == "" {
		t.Error("signed mode should have non-empty contentHash")
	}
}
