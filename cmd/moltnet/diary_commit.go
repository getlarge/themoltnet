package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// runDiaryCommitCmd is the parameterized business logic for diary commit.
func runDiaryCommitCmd(w io.Writer, apiURL, credPath, diaryID, rationale, risk, scope, operator, tool, title string, signed bool, importance int, extraTags string) error {
	if err := validateCommitFlags(diaryID, rationale, risk, scope, operator, tool, importance); err != nil {
		return err
	}

	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	imp := importance
	if imp == 0 {
		imp = deriveImportance(risk)
	}

	scopes := splitAndTrim(scope, ",")
	if len(scopes) == 0 {
		return fmt.Errorf("flag --scope must contain at least one non-empty scope")
	}
	var extraTagsList []string
	if extraTags != "" {
		extraTagsList = splitAndTrim(extraTags, ",")
	}

	fmt.Fprintln(os.Stderr, "Extracting git metadata...")
	meta, err := extractGitMeta()
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Branch: %s, files changed: %d\n", meta.Branch, meta.FilesChanged)

	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	payload := buildCommitPayload(rationale, meta, creds.Keys.Fingerprint, operator, tool, risk, scopes)
	tags := buildCommitTags(risk, meta.Branch, scopes, extraTagsList)

	entryTitle := title
	if entryTitle == "" {
		entryTitle = "Accountable commit: " + firstSentence(rationale)
	}

	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client, err := newAuthedClient(apiURL, tm)
	if err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "Creating diary entry...")
	result, err := signAndCreateEntry(client, creds, payload, diaryUUID, entryTitle, tags, imp, signed)
	if err != nil {
		return err
	}

	return json.NewEncoder(w).Encode(result)
}

type gitMeta struct {
	Branch       string
	FilesChanged int
	Refs         []string
}

type commitResult struct {
	EntryID   string `json:"entryId"`
	Signature string `json:"signature"`
}

// nowUTC returns the current UTC time as ISO 8601. Overridable for tests.
var nowUTC = func() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05Z")
}

// parseGitDiffStat parses the output of `git diff --cached --stat` and returns
// the number of files changed and up to 5 file paths.
func parseGitDiffStat(output string) (int, []string) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) == 0 || output == "" {
		return 0, nil
	}

	var refs []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Summary line: " 3 files changed, 10 insertions(+), 2 deletions(-)"
		if strings.Contains(line, "files changed") || strings.Contains(line, "file changed") {
			continue
		}
		// File line: " path/to/file.go | 10 ++--"
		parts := strings.SplitN(line, "|", 2)
		if len(parts) >= 1 {
			path := strings.TrimSpace(parts[0])
			if path != "" {
				refs = append(refs, path)
			}
		}
	}

	count := len(refs)
	if len(refs) > 5 {
		refs = refs[:5]
	}
	return count, refs
}

// buildCommitPayload constructs the <content> + <metadata> block for a commit entry.
func buildCommitPayload(rationale string, meta *gitMeta, fingerprint, operator, tool, risk string, scopes []string) string {
	var b strings.Builder
	b.WriteString("<content>\n")
	b.WriteString(rationale)
	b.WriteString("\n</content>\n")
	b.WriteString("<metadata>\n")
	fmt.Fprintf(&b, "signer: %s\n", fingerprint)
	fmt.Fprintf(&b, "operator: %s\n", operator)
	fmt.Fprintf(&b, "tool: %s\n", tool)
	fmt.Fprintf(&b, "risk-level: %s\n", risk)
	fmt.Fprintf(&b, "files-changed: %d\n", meta.FilesChanged)
	fmt.Fprintf(&b, "refs: %s\n", strings.Join(meta.Refs, ", "))
	fmt.Fprintf(&b, "timestamp: %s\n", nowUTC())
	fmt.Fprintf(&b, "branch: %s\n", meta.Branch)
	fmt.Fprintf(&b, "scope: %s\n", strings.Join(scopes, ", "))
	b.WriteString("</metadata>")
	return b.String()
}

// buildCommitTags generates the auto-generated tag list for a commit entry.
func buildCommitTags(risk, branch string, scopes, extraTags []string) []string {
	tags := []string{"accountable-commit", "risk:" + risk, "branch:" + branch}
	for _, s := range scopes {
		tags = append(tags, "scope:"+s)
	}
	tags = append(tags, extraTags...)
	return tags
}

// deriveImportance maps a risk level to a default importance value.
func deriveImportance(risk string) int {
	switch risk {
	case "high":
		return 8
	case "medium":
		return 5
	case "low":
		return 2
	default:
		return 5
	}
}

// firstSentence returns the first sentence of s (up to the first period).
// If there is no period, it returns s truncated to 80 runes (UTF-8 safe).
func firstSentence(s string) string {
	if idx := strings.Index(s, "."); idx >= 0 {
		return s[:idx+1]
	}
	runes := []rune(s)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return s
}

// validateCommitFlags validates all required flags for diary commit.
func validateCommitFlags(diaryID, rationale, risk, scope, operator, tool string, importance int) error {
	if diaryID == "" {
		return fmt.Errorf("flag --diary-id is required")
	}
	if _, err := uuid.Parse(diaryID); err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}
	if rationale == "" {
		return fmt.Errorf("flag --rationale is required")
	}
	if risk == "" {
		return fmt.Errorf("flag --risk is required")
	}
	if risk != "low" && risk != "medium" && risk != "high" {
		return fmt.Errorf("invalid risk %q: must be low, medium, or high", risk)
	}
	if scope == "" {
		return fmt.Errorf("flag --scope is required")
	}
	if operator == "" {
		return fmt.Errorf("flag --operator is required")
	}
	if tool == "" {
		return fmt.Errorf("flag --tool is required")
	}
	if importance != 0 && (importance < 1 || importance > 10) {
		return fmt.Errorf("invalid importance %d: must be between 1 and 10", importance)
	}
	return nil
}

// extractGitMeta extracts branch name and staged file info from git.
func extractGitMeta() (*gitMeta, error) {
	branchOut, err := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return nil, fmt.Errorf("git rev-parse: %w", err)
	}
	branch := strings.TrimSpace(string(branchOut))

	statOut, err := exec.Command("git", "diff", "--cached", "--stat").Output()
	if err != nil {
		return nil, fmt.Errorf("git diff --cached --stat: %w", err)
	}

	stat := strings.TrimSpace(string(statOut))
	if stat == "" {
		return nil, fmt.Errorf("no staged changes — stage files with 'git add' first")
	}

	filesChanged, refs := parseGitDiffStat(stat)
	return &gitMeta{
		Branch:       branch,
		FilesChanged: filesChanged,
		Refs:         refs,
	}, nil
}

// signAndCreateEntry creates a diary entry with optional content signing.
// When signed is false: creates a signing request for the payload, signs it,
// creates the entry without signingRequestId (message-level signature only).
// When signed is true: computes CID, creates a signing request for the CID,
// signs it, creates the entry with signingRequestId + contentHash.
func signAndCreateEntry(
	client *moltnetapi.Client,
	creds *CredentialsFile,
	payload string,
	diaryUUID uuid.UUID,
	title string,
	tags []string,
	importance int,
	signed bool,
) (*commitResult, error) {
	ctx := context.Background()
	entryType := moltnetapi.CreateDiaryEntryReqEntryTypeProcedural

	if signed {
		return signAndCreateEntrySigned(ctx, client, creds, payload, diaryUUID, title, tags, importance, entryType)
	}
	return signAndCreateEntryUnsigned(ctx, client, creds, payload, diaryUUID, title, tags, importance, entryType)
}

func signAndCreateEntrySigned(
	ctx context.Context,
	client *moltnetapi.Client,
	creds *CredentialsFile,
	payload string,
	diaryUUID uuid.UUID,
	title string,
	tags []string,
	importance int,
	entryType moltnetapi.CreateDiaryEntryReqEntryType,
) (*commitResult, error) {
	cid, err := computeContentCid("procedural", title, payload, tags)
	if err != nil {
		return nil, fmt.Errorf("compute CID: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Computed CID: %s\n", cid)

	sigRes, err := client.CreateSigningRequest(ctx, &moltnetapi.CreateSigningRequestReq{Message: cid})
	if err != nil {
		return nil, fmt.Errorf("create signing request: %w", err)
	}
	sigReq, ok := sigRes.(*moltnetapi.SigningRequest)
	if !ok {
		return nil, fmt.Errorf("unexpected signing request response type: %T", sigRes)
	}
	fmt.Fprintf(os.Stderr, "Signing request created: %s\n", sigReq.ID)

	sig, err := signWithRequestID(client, sigReq.ID.String(), creds.Keys.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("sign and submit: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Signature submitted\n")

	req := &moltnetapi.CreateDiaryEntryReq{
		Content:          payload,
		ContentHash:      moltnetapi.OptString{Value: cid, Set: true},
		SigningRequestId: moltnetapi.OptUUID{Value: sigReq.ID, Set: true},
		Tags:             tags,
		Title:            moltnetapi.OptString{Value: title, Set: true},
		EntryType:        moltnetapi.OptCreateDiaryEntryReqEntryType{Value: entryType, Set: true},
		Importance:       moltnetapi.OptInt{Value: importance, Set: true},
	}

	res, err := client.CreateDiaryEntry(ctx, req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return nil, fmt.Errorf("create signed entry: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", res)
	}
	fmt.Fprintf(os.Stderr, "Signed entry created: %s\n", entry.ID)
	return &commitResult{EntryID: entry.ID.String(), Signature: sig}, nil
}

func signAndCreateEntryUnsigned(
	ctx context.Context,
	client *moltnetapi.Client,
	creds *CredentialsFile,
	payload string,
	diaryUUID uuid.UUID,
	title string,
	tags []string,
	importance int,
	entryType moltnetapi.CreateDiaryEntryReqEntryType,
) (*commitResult, error) {
	sigRes, err := client.CreateSigningRequest(ctx, &moltnetapi.CreateSigningRequestReq{Message: payload})
	if err != nil {
		return nil, fmt.Errorf("create signing request: %w", err)
	}
	sigReq, ok := sigRes.(*moltnetapi.SigningRequest)
	if !ok {
		return nil, fmt.Errorf("unexpected signing request response type: %T", sigRes)
	}
	fmt.Fprintf(os.Stderr, "Signing request created: %s\n", sigReq.ID)

	sig, err := signWithRequestID(client, sigReq.ID.String(), creds.Keys.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("sign and submit: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Signature submitted\n")

	req := &moltnetapi.CreateDiaryEntryReq{
		Content:    payload,
		Tags:       tags,
		Title:      moltnetapi.OptString{Value: title, Set: true},
		EntryType:  moltnetapi.OptCreateDiaryEntryReqEntryType{Value: entryType, Set: true},
		Importance: moltnetapi.OptInt{Value: importance, Set: true},
	}

	res, err := client.CreateDiaryEntry(ctx, req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return nil, fmt.Errorf("create entry: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", res)
	}
	fmt.Fprintf(os.Stderr, "Entry created: %s\n", entry.ID)
	return &commitResult{EntryID: entry.ID.String(), Signature: sig}, nil
}
