package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
)

func runSign(args []string) error {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json (default: ~/.config/moltnet/moltnet.json)")
	nonce := fs.String("nonce", "", "Nonce from the signing request")
	requestID := fs.String("request-id", "", "Signing request ID — fetch, sign, and submit in one step")
	apiURL := fs.String("api-url", defaultAPIURL, "API URL (used with --request-id)")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet sign [options] <message>")
		fmt.Fprintln(os.Stderr, "       moltnet sign --request-id <id>")
		fmt.Fprintln(os.Stderr, "       echo <message> | moltnet sign --nonce <nonce> -")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Sign a message + nonce with your Ed25519 private key.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "With --request-id: fetches the signing request from the API,")
		fmt.Fprintln(os.Stderr, "signs the payload, and submits the signature — all in one step.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Without --request-id: signs the message+nonce locally and prints")
		fmt.Fprintln(os.Stderr, "the base64-encoded signature to stdout.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	creds, err := loadCredentials(*credPath)
	if err != nil {
		return err
	}

	// --request-id: one-shot fetch + sign + submit
	if *requestID != "" {
		if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
			return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
		}
		tm := NewTokenManager(*apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
		client := NewAPIClient(*apiURL, tm)
		if err := signWithRequestID(client, *requestID, creds.Keys.PrivateKey); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Signature submitted for request %s\n", *requestID)
		return nil
	}

	// Manual mode: --nonce + message positional arg
	if *nonce == "" {
		return fmt.Errorf("one of --nonce or --request-id is required\n\nUsage: moltnet sign --nonce <nonce> <message>\n       moltnet sign --request-id <id>")
	}

	payload, err := readPayload(fs.Args())
	if err != nil {
		return err
	}

	sig, err := SignForRequest(payload, *nonce, creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	fmt.Print(sig)
	return nil
}

// readPayload gets the payload from args or stdin.
func readPayload(args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("no payload provided\n\nUsage: moltnet sign <payload>\n       echo <payload> | moltnet sign -")
	}

	if args[0] == "-" {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("read stdin: %w", err)
		}
		if len(data) == 0 {
			return "", fmt.Errorf("empty stdin")
		}
		return string(data), nil
	}

	return args[0], nil
}

// loadCredentials reads credentials from the given path or the default location.
func loadCredentials(path string) (*CredentialsFile, error) {
	var creds *CredentialsFile
	var err error

	if path != "" {
		creds, err = ReadConfigFrom(path)
	} else {
		creds, err = ReadConfig()
	}

	if err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	if creds == nil {
		return nil, fmt.Errorf("no credentials found — run 'moltnet register' first")
	}
	return creds, nil
}

// signingRequestResponse holds the fields we need from a signing request.
type signingRequestResponse struct {
	ID      string `json:"id"`
	Message string `json:"message"`
	Nonce   string `json:"nonce"`
	Status  string `json:"status"`
}

// signWithRequestID fetches a signing request by ID, signs the payload, and submits the signature.
func signWithRequestID(client *APIClient, requestID, privateKey string) error {
	// Fetch the signing request
	body, err := client.Get("/crypto/signing-requests/" + requestID)
	if err != nil {
		return fmt.Errorf("fetch signing request: %w", err)
	}
	var req signingRequestResponse
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("decode signing request: %w", err)
	}
	if req.Status != "pending" {
		return fmt.Errorf("signing request %s is not pending (status: %s)", requestID, req.Status)
	}
	if req.Message == "" || req.Nonce == "" {
		return fmt.Errorf("signing request %s missing message or nonce", requestID)
	}

	// Sign
	sig, err := SignForRequest(req.Message, req.Nonce, privateKey)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	// Submit
	_, err = client.Post("/crypto/signing-requests/"+requestID+"/sign", map[string]string{
		"signature": sig,
	})
	if err != nil {
		return fmt.Errorf("submit signature: %w", err)
	}
	return nil
}
