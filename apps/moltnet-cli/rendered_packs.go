package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func runRenderedPacksList(apiURL, credPath, diaryID string, limit, offset int, sourcePackID, renderMethod string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	params := moltnetapi.ListDiaryRenderedPacksParams{ID: diaryUUID}
	if limit > 0 {
		params.Limit = moltnetapi.NewOptInt(limit)
	}
	if offset > 0 {
		params.Offset = moltnetapi.NewOptInt(offset)
	}
	if sourcePackID != "" {
		spID, err := uuid.Parse(sourcePackID)
		if err != nil {
			return fmt.Errorf("invalid --source-pack-id %q: %w", sourcePackID, err)
		}
		params.SourcePackId = moltnetapi.NewOptUUID(spID)
	}
	if renderMethod != "" {
		params.RenderMethod = moltnetapi.NewOptString(renderMethod)
	}

	res, err := client.ListDiaryRenderedPacks(context.Background(), params)
	if err != nil {
		return fmt.Errorf("rendered-packs list: %w", err)
	}

	list, ok := res.(*moltnetapi.RenderedPackList)
	if !ok {
		return formatAPIError(res)
	}

	return printJSON(list)
}

func runRenderedPacksGet(apiURL, credPath, id string) error {
	renderedPackID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid --id: %w", err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return fmt.Errorf("auth failed: %w", err)
	}

	res, err := client.GetRenderedPackById(
		context.Background(),
		moltnetapi.GetRenderedPackByIdParams{ID: renderedPackID},
	)
	if err != nil {
		return fmt.Errorf("rendered-packs get: %w", err)
	}

	pack, ok := res.(*moltnetapi.RenderedPackWithContent)
	if !ok {
		return formatAPIError(res)
	}

	return printJSON(pack)
}
