package main

import (
	"flag"
	"fmt"
	"io"
	"os"
)

func runSign(args []string) error {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json (default: ~/.config/moltnet/moltnet.json)")
	nonce := fs.String("nonce", "", "Nonce from the signing request (required)")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet sign [options] <message>")
		fmt.Fprintln(os.Stderr, "       echo <message> | moltnet sign --nonce <nonce> -")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Sign a message + nonce with your Ed25519 private key.")
		fmt.Fprintln(os.Stderr, "Reads the private key from moltnet.json (written by 'moltnet register').")
		fmt.Fprintln(os.Stderr, "Outputs base64-encoded signature to stdout.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	if *nonce == "" {
		return fmt.Errorf("nonce is required\n\nUsage: moltnet sign --nonce <nonce> <message>")
	}

	payload, err := readPayload(fs.Args())
	if err != nil {
		return err
	}

	creds, err := loadCredentials(*credPath)
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
