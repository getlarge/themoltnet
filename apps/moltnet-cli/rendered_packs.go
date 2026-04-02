package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

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
