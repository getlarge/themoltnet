package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"io"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func runSignCmd(w io.Writer, credPath, apiURL, nonce, requestID string, args []string) error {
	signer, err := resolveSigner(credPath)
	if err != nil {
		return err
	}

	// --request-id: one-shot fetch + sign + submit
	if requestID != "" {
		client, err := newAuthenticatedClient(apiURL, credPath)
		if err != nil {
			return err
		}
		sig, err := signer.SignDiaryEntry(context.Background(), client, requestID)
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

	// Manual nonce mode frames the payload locally; it needs the seed.
	local, ok := signer.(*localSeedSigner)
	if !ok {
		return fmt.Errorf("manual --nonce signing is not available through %s; use --request-id", signerURLEnv)
	}
	sig, err := SignForRequest(payload, nonce, local.creds.Keys.PrivateKey)
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

func validateSigningCredentials(creds *CredentialsFile) error {
	if creds == nil {
		return fmt.Errorf(
			"credentials missing Ed25519 private key — run 'moltnet register'",
		)
	}
	if _, err := decodeEd25519Seed(creds.Keys.PrivateKey); err != nil {
		return fmt.Errorf(
			"credentials contain an invalid Ed25519 private key: %w — run 'moltnet register' or 'moltnet config repair'",
			err,
		)
	}
	return nil
}

// signRawBytes signs already-framed bytes with Ed25519.
// Use when the server has already computed signing_input (base64-decoded).
// The private key is stored as a base64-encoded 32-byte seed.
func signRawBytes(rawBytes []byte, privateKeyBase64 string) (string, error) {
	seed, err := decodeEd25519Seed(privateKeyBase64)
	if err != nil {
		return "", err
	}
	priv := ed25519.NewKeyFromSeed(seed)
	sig := ed25519.Sign(priv, rawBytes)
	return base64.StdEncoding.EncodeToString(sig), nil
}

func newAgentSigningRequest(message string) *moltnetapi.CreateSigningRequestReq {
	return &moltnetapi.CreateSigningRequestReq{
		Message: message,
		VerificationMethod: moltnetapi.OptCreateSigningRequestReqVerificationMethod{
			Value: moltnetapi.CreateSigningRequestReqVerificationMethodAgentEd25519,
			Set:   true,
		},
	}
}

// signWithRequestID signs a pending request through the resolved Signer and
// returns the base64 signature.
func signWithRequestID(ctx context.Context, client *moltnetapi.Client, signer Signer, requestID string) (string, error) {
	return signer.SignDiaryEntry(ctx, client, requestID)
}
