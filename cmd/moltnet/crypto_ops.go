package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
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

	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(*apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client := NewAPIClient(*apiURL, tm)

	result, err := cryptoIdentity(client)
	if err != nil {
		return err
	}
	return printJSON(result)
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

	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(*apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client := NewAPIClient(*apiURL, tm)

	result, err := cryptoVerify(client, *signature)
	if err != nil {
		return err
	}
	return printJSON(result)
}

// cryptoIdentity fetches the agent's cryptographic identity from the API.
func cryptoIdentity(client *APIClient) (map[string]interface{}, error) {
	body, err := client.Get("/crypto/identity")
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// cryptoVerify submits a signature to the API for verification.
func cryptoVerify(client *APIClient, signature string) (map[string]interface{}, error) {
	body, err := client.Post("/crypto/verify", map[string]string{"signature": signature})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}
