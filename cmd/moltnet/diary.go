package main

import (
	"context"
	"fmt"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Diary-level business logic ---

// runDiaryListCmd lists all agent's diaries.
func runDiaryListCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListDiaries(context.Background(), moltnetapi.ListDiariesParams{})
	if err != nil {
		return fmt.Errorf("diary list: %w", err)
	}
	list, ok := res.(*moltnetapi.DiaryCatalogList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runDiaryCreateCmd creates a new diary.
func runDiaryCreateCmd(apiURL, credPath, name, visibility, teamID string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateDiaryReq{
		Name: name,
	}
	if visibility != "" {
		req.Visibility = moltnetapi.OptCreateDiaryReqVisibility{
			Value: moltnetapi.CreateDiaryReqVisibility(visibility),
			Set:   true,
		}
	}
	res, err := client.CreateDiary(context.Background(), req, moltnetapi.CreateDiaryParams{
		XMoltnetTeamID: uuid.MustParse(teamID),
	})
	if err != nil {
		return fmt.Errorf("diary create: %w", err)
	}
	diary, ok := res.(*moltnetapi.DiaryCatalog)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(diary)
}

// runDiaryGetCmd fetches a diary by ID.
func runDiaryGetCmd(apiURL, credPath, diaryID string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetDiary(context.Background(), moltnetapi.GetDiaryParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary get: %w", err)
	}
	diary, ok := res.(*moltnetapi.DiaryCatalog)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(diary)
}

// runDiaryTagsCmd lists tags for a diary.
func runDiaryTagsCmd(apiURL, credPath, diaryID, prefix, entryTypes string, minCount int) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	params := moltnetapi.ListDiaryTagsParams{DiaryId: diaryUUID}
	if prefix != "" {
		params.Prefix = moltnetapi.OptString{Value: prefix, Set: true}
	}
	if entryTypes != "" {
		params.EntryTypes = moltnetapi.OptString{Value: entryTypes, Set: true}
	}
	if minCount > 0 {
		params.MinCount = moltnetapi.OptInt{Value: minCount, Set: true}
	}
	res, err := client.ListDiaryTags(context.Background(), params)
	if err != nil {
		return fmt.Errorf("diary tags: %w", err)
	}
	tagsRes, ok := res.(*moltnetapi.DiaryTagsResponse)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(tagsRes)
}

// runDiaryCompileCmd compiles a context pack from a diary.
func runDiaryCompileCmd(
	apiURL, credPath, diaryID string,
	tokenBudget int,
	taskPrompt string,
	includeTags, excludeTags, entryTypes string,
	createdAfter, createdBefore string,
	wRecency, wImportance, lambda float64,
	wRecencyChanged, wImportanceChanged, lambdaChanged bool,
) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CompileDiaryReq{
		TokenBudget: tokenBudget,
	}
	if taskPrompt != "" {
		req.TaskPrompt = moltnetapi.OptString{Value: taskPrompt, Set: true}
	}
	if includeTags != "" {
		req.IncludeTags = splitAndTrim(includeTags, ",")
	}
	if excludeTags != "" {
		req.ExcludeTags = splitAndTrim(excludeTags, ",")
	}
	if entryTypes != "" {
		for _, et := range splitAndTrim(entryTypes, ",") {
			req.EntryTypes = append(req.EntryTypes, moltnetapi.CompileDiaryReqEntryTypesItem(et))
		}
	}
	if createdAfter != "" {
		t, err := time.Parse(time.RFC3339, createdAfter)
		if err != nil {
			return fmt.Errorf("invalid --created-after %q: %w", createdAfter, err)
		}
		req.CreatedAfter = moltnetapi.OptDateTime{Value: t, Set: true}
	}
	if createdBefore != "" {
		t, err := time.Parse(time.RFC3339, createdBefore)
		if err != nil {
			return fmt.Errorf("invalid --created-before %q: %w", createdBefore, err)
		}
		req.CreatedBefore = moltnetapi.OptDateTime{Value: t, Set: true}
	}
	if wRecencyChanged {
		req.WRecency = moltnetapi.OptFloat64{Value: wRecency, Set: true}
	}
	if wImportanceChanged {
		req.WImportance = moltnetapi.OptFloat64{Value: wImportance, Set: true}
	}
	if lambdaChanged {
		req.Lambda = moltnetapi.OptFloat64{Value: lambda, Set: true}
	}

	res, err := client.CompileDiary(context.Background(), req, moltnetapi.CompileDiaryParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary compile: %w", err)
	}
	result, ok := res.(*moltnetapi.CompileResult)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(result)
}
