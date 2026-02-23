package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
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
		client, err := newClientFromCreds(*apiURL)
		if err != nil {
			return err
		}
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

// signRawBytes signs already-framed bytes with Ed25519.
// Use when the server has already computed signing_input (base64-decoded).
// The private key is stored as a base64-encoded 32-byte seed.
func signRawBytes(rawBytes []byte, privateKeyBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(privateKeyBase64)
	if err != nil {
		return "", fmt.Errorf("decode private key: %w", err)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	sig := ed25519.Sign(priv, rawBytes)
	return base64.StdEncoding.EncodeToString(sig), nil
}

// signWithRequestID fetches a signing request by ID, signs the payload, and submits the signature.
func signWithRequestID(client *moltnetapi.Client, requestID, privateKey string) error {
	rid, err := uuid.Parse(requestID)
	if err != nil {
		return fmt.Errorf("invalid request ID %q: %w", requestID, err)
	}

	// Fetch the signing request
	res, err := client.GetSigningRequest(context.Background(), moltnetapi.GetSigningRequestParams{ID: rid})
	if err != nil {
		return fmt.Errorf("fetch signing request: %w", err)
	}
	req, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	if req.Status != moltnetapi.SigningRequestStatusPending {
		return fmt.Errorf("signing request %s is not pending (status: %s)", requestID, req.Status)
	}

	// Decode server-provided signing_input and sign the raw bytes directly.
	rawBytes, err := base64.StdEncoding.DecodeString(req.SigningInput)
	if err != nil {
		return fmt.Errorf("decode signing_input: %w", err)
	}
	sig, err := signRawBytes(rawBytes, privateKey)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	// Submit
	_, err = client.SubmitSignature(context.Background(),
		&moltnetapi.SubmitSignatureReq{Signature: sig},
		moltnetapi.SubmitSignatureParams{ID: rid},
	)
	if err != nil {
		return fmt.Errorf("submit signature: %w", err)
	}
	return nil
}
