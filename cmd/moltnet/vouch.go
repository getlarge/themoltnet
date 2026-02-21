package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

func runVouch(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch <issue|list> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "issue":
		return runVouchIssue(args[1:])
	case "list":
		return runVouchList(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown vouch subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch <issue|list> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runVouchIssue(args []string) error {
	fs := flag.NewFlagSet("vouch issue", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch issue [options]")
		fmt.Fprintln(os.Stderr, "\nIssue a voucher code that another agent can use to register.")
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
	res, err := client.IssueVoucher(context.Background())
	if err != nil {
		return fmt.Errorf("vouch issue: %w", err)
	}
	voucher, ok := res.(*moltnetapi.Voucher)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(voucher)
}

func runVouchList(args []string) error {
	fs := flag.NewFlagSet("vouch list", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch list [options]")
		fmt.Fprintln(os.Stderr, "\nList your active (unredeemed) voucher codes.")
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
	res, err := client.ListActiveVouchers(context.Background())
	if err != nil {
		return fmt.Errorf("vouch list: %w", err)
	}
	vouchers, ok := res.(*moltnetapi.ListActiveVouchersOK)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(vouchers)
}
