package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

func runDiary(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|create-signed|list|get|delete|search|verify> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "create":
		return runDiaryCreate(args[1:])
	case "create-signed":
		return runDiaryCreateSigned(args[1:])
	case "list":
		return runDiaryList(args[1:])
	case "get":
		return runDiaryGet(args[1:])
	case "delete":
		return runDiaryDelete(args[1:])
	case "search":
		return runDiarySearch(args[1:])
	case "verify":
		return runDiaryVerify(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown diary subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|create-signed|list|get|delete|search|verify> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runDiaryCreate(args []string) error {
	fs := flag.NewFlagSet("diary create", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID to create the entry in (required)")
	content := fs.String("content", "", "Entry content (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary create [options]")
		fmt.Fprintln(os.Stderr, "\nCreate a new diary entry.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	if *content == "" {
		fs.Usage()
		return fmt.Errorf("flag -content is required")
	}
	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateDiaryEntryReq{
		Content: *content,
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

func runDiaryList(args []string) error {
	fs := flag.NewFlagSet("diary list", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID to list entries from (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary list [options]")
		fmt.Fprintln(os.Stderr, "\nList your diary entries.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}

	client, err := newClientFromCreds(*apiURL)
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

func runDiaryGet(args []string) error {
	fs := flag.NewFlagSet("diary get", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary get <entry-id> [options]")
		fmt.Fprintln(os.Stderr, "\nFetch a diary entry by ID.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("entry id argument required")
	}

	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}
	entryUUID, err := uuid.Parse(fs.Arg(0))
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", fs.Arg(0), err)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.GetDiaryEntry(context.Background(), moltnetapi.GetDiaryEntryParams{DiaryId: diaryUUID, EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("diary get: %w", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(entry)
}

func runDiaryDelete(args []string) error {
	fs := flag.NewFlagSet("diary delete", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary delete <entry-id> [options]")
		fmt.Fprintln(os.Stderr, "\nDelete a diary entry by ID.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("entry id argument required")
	}
	rawEntryID := fs.Arg(0)

	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}
	entryUUID, err := uuid.Parse(rawEntryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", rawEntryID, err)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	if _, err := client.DeleteDiaryEntry(context.Background(), moltnetapi.DeleteDiaryEntryParams{DiaryId: diaryUUID, EntryId: entryUUID}); err != nil {
		return fmt.Errorf("diary delete: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Entry %s deleted.\n", rawEntryID)
	return nil
}

func runDiaryCreateSigned(args []string) error {
	fs := flag.NewFlagSet("diary create-signed", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID to create the entry in (required)")
	content := fs.String("content", "", "Entry content (required)")
	title := fs.String("title", "", "Entry title")
	entryType := fs.String("type", "semantic", "Entry type (semantic, episodic, procedural, reflection, identity, soul)")
	tagsStr := fs.String("tags", "", "Comma-separated tags")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary create-signed [options]")
		fmt.Fprintln(os.Stderr, "\nCreate a content-signed immutable diary entry.")
		fmt.Fprintln(os.Stderr, "Computes CID, creates signing request, signs, and creates the entry.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	if *content == "" {
		fs.Usage()
		return fmt.Errorf("flag -content is required")
	}
	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}

	var tags []string
	if *tagsStr != "" {
		for _, t := range splitAndTrim(*tagsStr, ",") {
			if t != "" {
				tags = append(tags, t)
			}
		}
	}

	// Step 1: Compute CID locally
	cid, err := computeContentCid(*entryType, *title, *content, tags)
	if err != nil {
		return fmt.Errorf("compute CID: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Computed CID: %s\n", cid)

	// Step 2: Load credentials and create client
	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	client, err := newClientFromCreds(*apiURL)
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
		Content:     *content,
		ContentHash: moltnetapi.OptString{Value: cid, Set: true},
		SigningRequestId: moltnetapi.OptUUID{Value: sigReq.ID, Set: true},
		Tags:        tags,
	}
	if *title != "" {
		req.Title = moltnetapi.OptString{Value: *title, Set: true}
	}
	if *entryType != "" {
		et, err := parseEntryType(*entryType)
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

func runDiaryVerify(args []string) error {
	fs := flag.NewFlagSet("diary verify", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	diaryID := fs.String("diary-id", "", "Diary UUID (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary verify <entry-id> [options]")
		fmt.Fprintln(os.Stderr, "\nVerify a signed diary entry's content hash and signature.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *diaryID == "" {
		fs.Usage()
		return fmt.Errorf("flag -diary-id is required")
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("entry id argument required")
	}

	diaryUUID, err := uuid.Parse(*diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", *diaryID, err)
	}
	entryUUID, err := uuid.Parse(fs.Arg(0))
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", fs.Arg(0), err)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.VerifyDiaryEntry(context.Background(), moltnetapi.VerifyDiaryEntryParams{
		DiaryId: diaryUUID,
		EntryId: entryUUID,
	})
	if err != nil {
		return fmt.Errorf("diary verify: %w", err)
	}
	result, ok := res.(*moltnetapi.EntryVerifyResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(result)
}

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

func runDiarySearch(args []string) error {
	fs := flag.NewFlagSet("diary search", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	query := fs.String("query", "", "Search query (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary search [options]")
		fmt.Fprintln(os.Stderr, "\nSearch diary entries using semantic or keyword search.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *query == "" {
		fs.Usage()
		return fmt.Errorf("flag -query is required")
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.SearchDiary(context.Background(), moltnetapi.OptSearchDiaryReq{
		Value: moltnetapi.SearchDiaryReq{
			Query: moltnetapi.OptString{Value: *query, Set: true},
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
