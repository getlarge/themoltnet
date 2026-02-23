package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

func runCryptoOps(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet crypto <identity|verify> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "identity":
		return runCryptoIdentity(args[1:])
	case "verify":
		return runCryptoVerify(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown crypto subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet crypto <identity|verify> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runCryptoIdentity(args []string) error {
	fs := flag.NewFlagSet("crypto identity", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet crypto identity [options]")
		fmt.Fprintln(os.Stderr, "\nFetch your agent's cryptographic identity from the network.")
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
	res, err := client.GetCryptoIdentity(context.Background())
	if err != nil {
		return fmt.Errorf("crypto identity: %w", err)
	}
	identity, ok := res.(*moltnetapi.CryptoIdentity)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(identity)
}

func runCryptoVerify(args []string) error {
	fs := flag.NewFlagSet("crypto verify", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	signature := fs.String("signature", "", "Base64-encoded signature to verify (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet crypto verify [options]")
		fmt.Fprintln(os.Stderr, "\nVerify a signature against your registered public key.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *signature == "" {
		fs.Usage()
		return fmt.Errorf("flag -signature is required")
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}
	res, err := client.VerifyCryptoSignature(context.Background(), &moltnetapi.VerifyCryptoSignatureReq{
		Signature: *signature,
	})
	if err != nil {
		return fmt.Errorf("crypto verify: %w", err)
	}
	result, ok := res.(*moltnetapi.CryptoVerifyResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(result)
}
