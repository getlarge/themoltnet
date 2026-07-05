package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Entry-level business logic (moved from diary.go) ---

// runEntryCreateCmd creates a diary entry.
func runEntryCreateCmd(apiURL, credPath, diaryID, content, title, entryType, tagsStr string, importance int, importanceChanged bool) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateDiaryEntryReq{
		Content: content,
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
	if tagsStr != "" {
		req.Tags = splitAndTrim(tagsStr, ",")
	}
	if importanceChanged {
		req.Importance = moltnetapi.OptInt{Value: importance, Set: true}
	}
	res, err := client.CreateDiaryEntry(context.Background(), req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return fmt.Errorf("entry create: %w", formatTransportError(err))
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(entry)
}

// runEntryCreateSignedCmd creates a content-signed immutable diary entry.
func runEntryCreateSignedCmd(apiURL, credPath, diaryID, content, title, entryType, tagsStr string, importance int, importanceChanged bool) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	// Validate entryType before any server-side side effects (signing
	// request creation is non-reversible — a bad --type should fail
	// fast rather than leave an orphaned completed signing request).
	var parsedEntryType moltnetapi.CreateDiaryEntryReqEntryType
	if entryType != "" {
		parsedEntryType, err = parseEntryType(entryType)
		if err != nil {
			return err
		}
	}

	tags := splitAndTrim(tagsStr, ",")

	// Step 1: Compute CID locally
	cid, err := computeContentCid(entryType, title, content, tags)
	if err != nil {
		return fmt.Errorf("compute CID: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Computed CID: %s\n", cid)

	// Step 2: Load credentials and create client
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	// Step 3: Create signing request with CID as message
	sigRes, err := client.CreateSigningRequest(context.Background(), &moltnetapi.CreateSigningRequestReq{
		Message: cid,
	})
	if err != nil {
		return fmt.Errorf("create signing request: %w", formatTransportError(err))
	}
	sigReq, ok := sigRes.(*moltnetapi.SigningRequest)
	if !ok {
		return formatAPIError(sigRes)
	}
	fmt.Fprintf(os.Stderr, "Signing request created: %s\n", sigReq.ID)

	// Step 4: Sign and submit
	_, err = signWithRequestID(client, sigReq.ID.String(), creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("sign and submit: %w", formatTransportError(err))
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
		req.EntryType = moltnetapi.OptCreateDiaryEntryReqEntryType{Value: parsedEntryType, Set: true}
	}
	if importanceChanged {
		req.Importance = moltnetapi.OptInt{Value: importance, Set: true}
	}

	res, err := client.CreateDiaryEntry(context.Background(), req, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryUUID})
	if err != nil {
		return fmt.Errorf("entry create-signed: %w", formatTransportError(err))
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return formatAPIError(res)
	}
	fmt.Fprintf(os.Stderr, "Signed entry created: %s\n", entry.ID)
	return printJSON(entry)
}

// runEntryListCmd lists diary entries with optional filters.
func runEntryListCmd(apiURL, credPath, diaryID, ids, tags, excludeTags, entryType string, limit, offset int) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	params := moltnetapi.ListDiaryEntriesParams{DiaryId: diaryUUID}
	if ids != "" {
		parsedIDs, err := parseUUIDList(ids)
		if err != nil {
			return err
		}
		params.Ids = parsedIDs
	}
	if tags != "" {
		params.Tags = splitAndTrim(tags, ",")
	}
	if excludeTags != "" {
		params.ExcludeTags = splitAndTrim(excludeTags, ",")
	}
	if entryType != "" {
		entryTypes, err := parseListDiaryEntryTypes(entryType)
		if err != nil {
			return err
		}
		params.EntryType = entryTypes
	}
	if limit > 0 {
		params.Limit = moltnetapi.OptFloat64{Value: float64(limit), Set: true}
	}
	if offset > 0 {
		params.Offset = moltnetapi.OptFloat64{Value: float64(offset), Set: true}
	}
	res, err := client.ListDiaryEntries(context.Background(), params)
	if err != nil {
		return fmt.Errorf("entry list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.DiaryList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runEntryGetCmd fetches a diary entry by ID, optionally expanding relations.
func runEntryGetCmd(apiURL, credPath, entryID, expand string, depth int) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	if expand != "" && expand != "relations" {
		return fmt.Errorf("--expand: unsupported value %q (only \"relations\" is valid)", expand)
	}

	params := moltnetapi.GetDiaryEntryByIdParams{EntryId: entryUUID}
	if expand == "relations" {
		params.Expand = moltnetapi.OptGetDiaryEntryByIdExpand{
			Value: moltnetapi.GetDiaryEntryByIdExpandRelations,
			Set:   true,
		}
		params.Depth = moltnetapi.OptInt{Value: depth, Set: true}
	}

	res, err := client.GetDiaryEntryById(context.Background(), params)
	if err != nil {
		return fmt.Errorf("entry get: %w", formatTransportError(err))
	}
	entry, ok := res.(*moltnetapi.DiaryEntryWithRelations)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(entry)
}

// runEntryUpdateCmd updates a diary entry by ID.
func runEntryUpdateCmd(apiURL, credPath, entryID, content, title, entryType, tagsStr string, importance int, importanceChanged bool) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := moltnetapi.UpdateDiaryEntryByIdReq{}
	if content != "" {
		req.Content = moltnetapi.OptString{Value: content, Set: true}
	}
	if title != "" {
		req.Title = moltnetapi.OptString{Value: title, Set: true}
	}
	if entryType != "" {
		req.EntryType = moltnetapi.OptUpdateDiaryEntryByIdReqEntryType{
			Value: moltnetapi.UpdateDiaryEntryByIdReqEntryType(entryType),
			Set:   true,
		}
	}
	if tagsStr != "" {
		req.Tags = splitAndTrim(tagsStr, ",")
	}
	if importanceChanged {
		req.Importance = moltnetapi.OptInt{Value: importance, Set: true}
	}

	res, err := client.UpdateDiaryEntryById(context.Background(),
		moltnetapi.OptUpdateDiaryEntryByIdReq{Value: req, Set: true},
		moltnetapi.UpdateDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("entry update: %w", formatTransportError(err))
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(entry)
}

// runEntryDeleteCmd deletes a diary entry by ID.
func runEntryDeleteCmd(apiURL, credPath, entryID string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	if _, err := client.DeleteDiaryEntryById(context.Background(), moltnetapi.DeleteDiaryEntryByIdParams{EntryId: entryUUID}); err != nil {
		return fmt.Errorf("entry delete: %w", formatTransportError(err))
	}
	fmt.Fprintf(os.Stderr, "Entry %s deleted.\n", entryID)
	return nil
}

type entrySearchOptions struct {
	query                    string
	diaryID                  string
	tags                     string
	excludeTags              string
	entryTypes               string
	limit                    int
	offset                   int
	excludeSuperseded        bool
	excludeSupersededChanged bool
	wRelevance               float64
	wRecency                 float64
	wImportance              float64
	wRelevanceChanged        bool
	wRecencyChanged          bool
	wImportanceChanged       bool
	taskID                   string
	taskType                 string
	taskCorrelationID        string
	taskAttempt              int
	taskAttemptChanged       bool
}

// runEntrySearchCmd searches diary entries.
func runEntrySearchCmd(apiURL, credPath string, opts entrySearchOptions) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := moltnetapi.SearchDiaryReq{}
	if opts.query != "" {
		req.Query = moltnetapi.OptString{Value: opts.query, Set: true}
	}
	if opts.diaryID != "" {
		diaryUUID, err := uuid.Parse(opts.diaryID)
		if err != nil {
			return fmt.Errorf("invalid diary ID %q: %w", opts.diaryID, err)
		}
		req.DiaryId = moltnetapi.OptUUID{Value: diaryUUID, Set: true}
	}
	if opts.tags != "" {
		req.Tags = splitAndTrim(opts.tags, ",")
	}
	if opts.excludeTags != "" {
		req.ExcludeTags = splitAndTrim(opts.excludeTags, ",")
	}
	if opts.entryTypes != "" {
		parsedEntryTypes, err := parseSearchDiaryEntryTypes(opts.entryTypes)
		if err != nil {
			return err
		}
		req.EntryTypes = parsedEntryTypes
	}
	taskTags := compileTaskFilterTags(opts.taskID, opts.taskType, opts.taskCorrelationID, opts.taskAttempt, opts.taskAttemptChanged)
	if len(taskTags) > 0 {
		req.Tags = append(req.Tags, taskTags...)
	}
	if opts.limit > 0 {
		req.Limit = moltnetapi.OptFloat64{Value: float64(opts.limit), Set: true}
	}
	if opts.offset > 0 {
		req.Offset = moltnetapi.OptFloat64{Value: float64(opts.offset), Set: true}
	}
	if opts.excludeSupersededChanged {
		req.ExcludeSuperseded = moltnetapi.OptBool{Value: opts.excludeSuperseded, Set: true}
	}
	if opts.wRelevanceChanged {
		req.WRelevance = moltnetapi.OptFloat64{Value: opts.wRelevance, Set: true}
	}
	if opts.wRecencyChanged {
		req.WRecency = moltnetapi.OptFloat64{Value: opts.wRecency, Set: true}
	}
	if opts.wImportanceChanged {
		req.WImportance = moltnetapi.OptFloat64{Value: opts.wImportance, Set: true}
	}
	if !hasEntrySearchCriteria(req) {
		return fmt.Errorf("entry search: provide --query or at least one filter flag")
	}
	res, err := client.SearchDiary(context.Background(), moltnetapi.OptSearchDiaryReq{
		Value: req,
		Set:   true,
	})
	if err != nil {
		return fmt.Errorf("entry search: %w", formatTransportError(err))
	}
	results, ok := res.(*moltnetapi.DiarySearchResult)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(results)
}

func hasEntrySearchCriteria(req moltnetapi.SearchDiaryReq) bool {
	return req.Query.Set ||
		req.DiaryId.Set ||
		len(req.Tags) > 0 ||
		len(req.ExcludeTags) > 0 ||
		len(req.EntryTypes) > 0 ||
		req.Limit.Set ||
		req.Offset.Set ||
		req.ExcludeSuperseded.Set ||
		req.WRelevance.Set ||
		req.WRecency.Set ||
		req.WImportance.Set
}

// runEntryVerifyCmd verifies a signed diary entry.
func runEntryVerifyCmd(apiURL, credPath, entryID string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.VerifyDiaryEntryById(context.Background(), moltnetapi.VerifyDiaryEntryByIdParams{EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("entry verify: %w", formatTransportError(err))
	}
	result, ok := res.(*moltnetapi.EntryVerifyResult)
	if !ok {
		return formatAPIError(res)
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
	default:
		return "", fmt.Errorf("unknown entry type %q (valid: semantic, episodic, procedural, reflection)", s)
	}
}

func parseUUIDList(s string) ([]uuid.UUID, error) {
	values := splitAndTrim(s, ",")
	parsed := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, fmt.Errorf("invalid UUID %q: %w", value, err)
		}
		parsed = append(parsed, id)
	}
	return parsed, nil
}

func parseListDiaryEntryTypes(s string) ([]moltnetapi.ListDiaryEntriesEntryTypeItem, error) {
	values := splitAndTrim(s, ",")
	parsed := make([]moltnetapi.ListDiaryEntriesEntryTypeItem, 0, len(values))
	for _, value := range values {
		if _, err := parseEntryType(value); err != nil {
			return nil, err
		}
		parsed = append(parsed, moltnetapi.ListDiaryEntriesEntryTypeItem(value))
	}
	return parsed, nil
}

func parseSearchDiaryEntryTypes(s string) ([]moltnetapi.SearchDiaryReqEntryTypesItem, error) {
	values := splitAndTrim(s, ",")
	parsed := make([]moltnetapi.SearchDiaryReqEntryTypesItem, 0, len(values))
	for _, value := range values {
		if _, err := parseEntryType(value); err != nil {
			return nil, err
		}
		parsed = append(parsed, moltnetapi.SearchDiaryReqEntryTypesItem(value))
	}
	return parsed, nil
}

func compileTaskFilterTags(taskID, taskType, taskCorrelationID string, taskAttempt int, taskAttemptChanged bool) []string {
	tags := make([]string, 0, 4)
	if taskID != "" {
		tags = append(tags, "task:id:"+taskID)
	}
	if taskType != "" {
		tags = append(tags, "task:type:"+taskType)
	}
	if taskCorrelationID != "" {
		tags = append(tags, "task:correlation:"+taskCorrelationID)
	}
	if taskAttemptChanged {
		tags = append(tags, fmt.Sprintf("task:attempt:%d", taskAttempt))
	}
	return tags
}
