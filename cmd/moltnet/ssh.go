package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"
)

// ToSSHPublicKey converts a MoltNet public key ("ed25519:<base64>") to SSH authorized_keys format.
func ToSSHPublicKey(moltnetPublicKey string) (string, error) {
	raw, err := ParsePublicKey(moltnetPublicKey)
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}

	sshPub, err := gossh.NewPublicKey(ed25519.PublicKey(raw))
	if err != nil {
		return "", fmt.Errorf("create ssh public key: %w", err)
	}

	authorized := gossh.MarshalAuthorizedKey(sshPub)
	return strings.TrimSpace(string(authorized)), nil
}

// ToSSHPrivateKey converts a base64-encoded Ed25519 seed to OpenSSH PEM private key format.
func ToSSHPrivateKey(seedBase64 string) (string, error) {
	seed, err := base64.StdEncoding.DecodeString(seedBase64)
	if err != nil {
		return "", fmt.Errorf("decode seed: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return "", fmt.Errorf("seed must be 32 bytes, got %d", len(seed))
	}

	priv := ed25519.NewKeyFromSeed(seed)
	pemBlock, err := gossh.MarshalPrivateKey(priv, "")
	if err != nil {
		return "", fmt.Errorf("marshal private key: %w", err)
	}

	pemBytes := pem.EncodeToMemory(pemBlock)
	return string(pemBytes), nil
}

func runSSHKeyExport(args []string) error {
	fs := flag.NewFlagSet("ssh-key", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to credentials.json (default: ~/.config/moltnet/credentials.json)")
	outDir := fs.String("output-dir", "", "Output directory for SSH keys (default: ~/.config/moltnet/ssh/)")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet ssh-key [options]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Export MoltNet Ed25519 identity as SSH key files.")
		fmt.Fprintln(os.Stderr, "Reads the keypair from credentials.json and writes")
		fmt.Fprintln(os.Stderr, "id_ed25519 and id_ed25519.pub to the output directory.")
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

	// Resolve output directory
	dir := *outDir
	if dir == "" {
		configDir, err := GetConfigDir()
		if err != nil {
			return err
		}
		dir = filepath.Join(configDir, "ssh")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	// Generate SSH keys
	pubSSH, err := ToSSHPublicKey(creds.Keys.PublicKey)
	if err != nil {
		return fmt.Errorf("convert public key: %w", err)
	}

	privPEM, err := ToSSHPrivateKey(creds.Keys.PrivateKey)
	if err != nil {
		return fmt.Errorf("convert private key: %w", err)
	}

	// Write files
	privPath := filepath.Join(dir, "id_ed25519")
	if err := os.WriteFile(privPath, []byte(privPEM), 0o600); err != nil {
		return fmt.Errorf("write private key: %w", err)
	}

	pubPath := filepath.Join(dir, "id_ed25519.pub")
	if err := os.WriteFile(pubPath, []byte(pubSSH+"\n"), 0o644); err != nil {
		return fmt.Errorf("write public key: %w", err)
	}

	fmt.Fprintf(os.Stderr, "SSH private key written to %s\n", privPath)
	fmt.Fprintf(os.Stderr, "SSH public key written to %s\n", pubPath)
	return nil
}
