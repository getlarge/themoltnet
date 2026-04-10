package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/google/uuid"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func runPacksGetCmd(args []string) error {
	fs := flag.NewFlagSet("packs get", flag.ExitOnError)
	packID := fs.String("id", "", "Pack ID (UUID)")
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet packs get [options]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}

	res, err := client.GetPack(context.Background(), moltnetapi.GetPackParams{
		PackId: uuid.MustParse(*packID),
	})
	if err != nil {
		return fmt.Errorf("packs get: %w", err)
	}

	pack, ok := res.(*moltnetapi.GetPackOK)
	if !ok {
		return formatAPIError("packs get", res)
	}

	return printJSON(pack)
}
