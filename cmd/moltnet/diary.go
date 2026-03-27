package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Parameterized business logic (called by Cobra commands) ---

// runDiaryCreateCmd is the flag-free business logic for diary create.
func runDiaryCreateCmd(apiURL, diaryID, content string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateDiaryEntryReq{
		Content: content,
	}
	res, err := client.CreateDiaryEntry(context.Background(), req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary create: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(entry)
}

// runDiaryCreateSignedCmd is the flag-free business logic for diary create-signed.
func runDiaryCreateSignedCmd(apiURL, diaryID, content, title, entryType, tagsStr string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	var tags []string
	if tagsStr != "" {
		for _, t := range splitAndTrim(tagsStr, ",") {
			if t != "" {
				tags = append(tags, t)
			}
		}
	}

	// Step 1: Compute CID locally
	cid, err := computeContentCid(entryType, title, content, tags)
	if err != nil {
		return fmt.Errorf("compute CID: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Computed CID: %s\n", cid)

	// Step 2: Load credentials and create client
	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}

	// Step 3: Create signing request with CID as message
	sigRes, err := client.CreateSigningRequest(context.Background(), &moltnetapi.CreateSigningRequestReq{
		Message: cid,
	})
	if err != nil {
		return fmt.Errorf("create signing request: %w", err)
	}
	sigReq, ok := sigRes.(*moltnetapi.SigningRequest)
	if !ok {
		return fmt.Errorf("unexpected signing request response type: %T", sigRes)
	}
	fmt.Fprintf(os.Stderr, "Signing request created: %s\n", sigReq.ID)

	// Step 4: Sign and submit
	_, err = signWithRequestID(client, sigReq.ID.String(), creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("sign and submit: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Signature submitted\n")

	// Step 5: Create signed entry
	req := &moltnetapi.CreateDiaryEntryReq{
		Content:          content,
		ContentHash:      moltnetapi.OptString{Value: cid, Set: true},
		SigningRequestId: moltnetapi.OptUUID{Value: sigReq.ID, Set: true},
		Tags:             tags,
	}
	if title != "" {
		req.Title = moltnetapi.OptString{Value: title, Set: true}
	}
	if entryType != "" {
		et, err := parseEntryType(entryType)
		if err != nil {
			return err
		}
		req.EntryType = moltnetapi.OptCreateDiaryEntryReqEntryType{Value: et, Set: true}
	}

	res, err := client.CreateDiaryEntry(context.Background(), req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary create-signed: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	fmt.Fprintf(os.Stderr, "Signed entry created: %s\n", entry.ID)
	return printJSON(entry)
}

// runDiaryListCmd is the flag-free business logic for diary list.
func runDiaryListCmd(apiURL, diaryID string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	res, err := client.ListDiaryEntries(context.Background(), moltnetapi.ListDiaryEntriesParams{DiaryId: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary list: %w", err)
	}
	list, ok := res.(*moltnetapi.DiaryList)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(list)
}

// runDiaryGetCmd is the flag-free business logic for diary get.
func runDiaryGetCmd(apiURL, entryID string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	res, err := client.GetDiaryEntryById(context.Background(), moltnetapi.GetDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("diary get: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(entry)
}

// runDiaryDeleteCmd is the flag-free business logic for diary delete.
func runDiaryDeleteCmd(apiURL, entryID string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	if _, err := client.DeleteDiaryEntryById(context.Background(), moltnetapi.DeleteDiaryEntryByIdParams{EntryId: entryUUID}); err != nil {
		return fmt.Errorf("diary delete: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Entry %s deleted.\n", entryID)
	return nil
}

// runDiarySearchCmd is the flag-free business logic for diary search.
func runDiarySearchCmd(apiURL, query string) error {
	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	res, err := client.SearchDiary(context.Background(), moltnetapi.OptSearchDiaryReq{
		Value: moltnetapi.SearchDiaryReq{
			Query: moltnetapi.OptString{Value: query, Set: true},
		},
		Set: true,
	})
	if err != nil {
		return fmt.Errorf("diary search: %w", err)
	}
	results, ok := res.(*moltnetapi.DiarySearchResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(results)
}

// runDiaryVerifyCmd is the flag-free business logic for diary verify.
func runDiaryVerifyCmd(apiURL, entryID string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL)
	if err != nil {
		return err
	}
	res, err := client.VerifyDiaryEntryById(context.Background(), moltnetapi.VerifyDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("diary verify: %w", err)
	}
	result, ok := res.(*moltnetapi.EntryVerifyResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(result)
}

// --- Utility functions ---

// splitAndTrim splits a string by sep and trims whitespace from each part.
func splitAndTrim(s, sep string) []string {
	parts := make([]string, 0)
	for _, p := range strings.Split(s, sep) {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

// parseEntryType converts a string to the API entry type enum.
func parseEntryType(s string) (moltnetapi.CreateDiaryEntryReqEntryType, error) {
	switch s {
	case "semantic":
		return moltnetapi.CreateDiaryEntryReqEntryTypeSemantic, nil
	case "episodic":
		return moltnetapi.CreateDiaryEntryReqEntryTypeEpisodic, nil
	case "procedural":
		return moltnetapi.CreateDiaryEntryReqEntryTypeProcedural, nil
	case "reflection":
		return moltnetapi.CreateDiaryEntryReqEntryTypeReflection, nil
	case "identity":
		return moltnetapi.CreateDiaryEntryReqEntryTypeIdentity, nil
	case "soul":
		return moltnetapi.CreateDiaryEntryReqEntryTypeSoul, nil
	default:
		return "", fmt.Errorf("unknown entry type %q (valid: semantic, episodic, procedural, reflection, identity, soul)", s)
	}
}

