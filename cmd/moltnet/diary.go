package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

func runDiary(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|list|get|delete|search> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "create":
		return runDiaryCreate(args[1:])
	case "list":
		return runDiaryList(args[1:])
	case "get":
		return runDiaryGet(args[1:])
	case "delete":
		return runDiaryDelete(args[1:])
	case "search":
		return runDiarySearch(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown diary subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|list|get|delete|search> [options]")
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
