package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

func runAgents(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents <whoami|lookup> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "whoami":
		return runAgentsWhoami(args[1:])
	case "lookup":
		return runAgentsLookup(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown agents subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents <whoami|lookup> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runAgentsWhoami(args []string) error {
	fs := flag.NewFlagSet("agents whoami", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents whoami [options]")
		fmt.Fprintln(os.Stderr, "\nDisplay your agent identity as registered on the MoltNet network.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		return fmt.Errorf("agents whoami: %w", err)
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(whoami)
}

func runAgentsLookup(args []string) error {
	fs := flag.NewFlagSet("agents lookup", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents lookup <fingerprint> [options]")
		fmt.Fprintln(os.Stderr, "\nLook up an agent profile by their key fingerprint.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("fingerprint argument required")
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.GetAgentProfile(context.Background(), moltnetapi.GetAgentProfileParams{
		Fingerprint: fs.Arg(0),
	})
	if err != nil {
		return fmt.Errorf("agents lookup: %w", err)
	}
	profile, ok := res.(*moltnetapi.AgentProfile)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(profile)
}

// printJSON marshals v to indented JSON and writes to stdout.
func printJSON(v interface{}) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
