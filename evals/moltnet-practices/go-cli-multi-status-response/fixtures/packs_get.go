package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

const defaultAPIURL = "https://api.themolt.net"

func validateUUID(s string) (uuid.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid UUID %q: %w", s, err)
	}
	return id, nil
}

func runPacksGetCmd(args []string) error {
	fs := flag.NewFlagSet("packs get", flag.ExitOnError)
	packID := fs.String("id", "", "Pack ID (UUID)")
	apiURL := fs.String("api-url", defaultAPIURL, "API base URL")
	format := fs.String("format", "json", "Output format: json or table")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet packs get [options]")
		fmt.Fprintln(os.Stderr)
		fmt.Fprintln(os.Stderr, "Retrieve a context pack by ID.")
		fmt.Fprintln(os.Stderr)
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *packID == "" {
		fs.Usage()
		return fmt.Errorf("--id is required")
	}

	id, err := validateUUID(*packID)
	if err != nil {
		return err
	}

	if *format != "json" && *format != "table" {
		return fmt.Errorf("unsupported format %q; use json or table", *format)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}

	res, err := client.GetPack(context.Background(), moltnetapi.GetPackParams{
		PackId: id,
	})
	if err != nil {
		return fmt.Errorf("packs get: %w", err)
	}

	pack, ok := res.(*moltnetapi.GetPackOK)
	if !ok {
		return formatAPIError("packs get", res)
	}

	if strings.EqualFold(*format, "table") {
		return printTable(pack)
	}
	return printJSON(pack)
}
