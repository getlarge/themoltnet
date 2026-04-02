package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"io"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func runSignCmd(w io.Writer, credPath, apiURL, nonce, requestID string, args []string) error {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	// --request-id: one-shot fetch + sign + submit
	if requestID != "" {
		if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
			return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
		}
		client, err := newClientFromCreds(apiURL, credPath)
		if err != nil {
			return err
		}
		sig, err := signWithRequestID(client, requestID, creds.Keys.PrivateKey)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "Signature submitted for request %s\n", requestID)
		// Print the base64 signature to stdout so callers can capture it
		fmt.Fprint(w, sig)
		return nil
	}

	// Manual mode: --nonce + message positional arg
	if nonce == "" {
		return fmt.Errorf("one of --nonce or --request-id is required")
	}

	payload, err := readPayload(args)
	if err != nil {
		return err
	}

	sig, err := SignForRequest(payload, nonce, creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("sign: %w", err)
	}

	fmt.Fprint(w, sig)
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
// Returns the base64-encoded signature on success.
func signWithRequestID(client *moltnetapi.Client, requestID, privateKey string) (string, error) {
	rid, err := uuid.Parse(requestID)
	if err != nil {
		return "", fmt.Errorf("invalid request ID %q: %w", requestID, err)
	}

	// Fetch the signing request
	res, err := client.GetSigningRequest(context.Background(), moltnetapi.GetSigningRequestParams{ID: rid})
	if err != nil {
		return "", fmt.Errorf("fetch signing request: %w", err)
	}
	req, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return "", formatAPIError(res)
	}
	if req.Status != moltnetapi.SigningRequestStatusPending {
		return "", fmt.Errorf("signing request %s is not pending (status: %s)", requestID, req.Status)
	}

	// Decode server-provided signing_input and sign the raw bytes directly.
	rawBytes, err := base64.StdEncoding.DecodeString(req.SigningInput)
	if err != nil {
		return "", fmt.Errorf("decode signing_input: %w", err)
	}
	sig, err := signRawBytes(rawBytes, privateKey)
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	// Submit
	_, err = client.SubmitSignature(context.Background(),
		&moltnetapi.SubmitSignatureReq{Signature: sig},
		moltnetapi.SubmitSignatureParams{ID: rid},
	)
	if err != nil {
		return "", fmt.Errorf("submit signature: %w", err)
	}
	return sig, nil
}
