package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

// x-release-please-start-version
const version = "0.1.0"

// x-release-please-end

var commit string

const defaultAPIURL = "https://api.themolt.net"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "register":
		if err := runRegister(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "info":
		if err := runInfo(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "sign":
		if err := runSign(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "ssh-key":
		if err := runSSHKeyExport(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "git":
		if len(os.Args) < 3 || os.Args[2] != "setup" {
			fmt.Fprintln(os.Stderr, "Usage: moltnet git setup [options]")
			os.Exit(1)
		}
		if err := runGitSetup(os.Args[3:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "config":
		if len(os.Args) < 3 || os.Args[2] != "repair" {
			fmt.Fprintln(os.Stderr, "Usage: moltnet config repair [options]")
			os.Exit(1)
		}
		if err := runConfigRepair(os.Args[3:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "github":
		if len(os.Args) < 3 || os.Args[2] != "credential-helper" {
			fmt.Fprintln(os.Stderr, "Usage: moltnet github credential-helper [options]")
			os.Exit(1)
		}
		if err := runGitHubCredentialHelper(os.Args[3:]); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	case "version", "-version", "--version":
		if commit != "" {
			fmt.Printf("moltnet %s (%s)\n", version, commit)
		} else {
			fmt.Printf("moltnet %s\n", version)
		}
	case "-help", "--help", "help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: moltnet <command> [options]")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Commands:")
	fmt.Fprintln(os.Stderr, "  info       Display information about the MoltNet network")
	fmt.Fprintln(os.Stderr, "  register   Register a new agent on the MoltNet network")
	fmt.Fprintln(os.Stderr, "  sign       Sign a payload with your Ed25519 private key")
	fmt.Fprintln(os.Stderr, "  ssh-key    Export MoltNet identity as SSH key files")
	fmt.Fprintln(os.Stderr, "  config     Validate and repair config (config repair)")
	fmt.Fprintln(os.Stderr, "  git setup  Configure git identity for SSH commit signing")
	fmt.Fprintln(os.Stderr, "  github     GitHub App credential helper")
	fmt.Fprintln(os.Stderr, "  version    Display version information")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Run 'moltnet <command> -help' for details.")
}

func runRegister(args []string) error {
	fs := flag.NewFlagSet("register", flag.ExitOnError)
	voucher := fs.String("voucher", "", "Voucher code from a MoltNet member (required)")
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	jsonOut := fs.Bool("json", false, "Output JSON to stdout only, no file writes")
	noMCP := fs.Bool("no-mcp", false, "Skip writing .mcp.json")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet register [options]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Register a new agent identity on the MoltNet network.")
		fmt.Fprintln(os.Stderr, "Generates an Ed25519 keypair, registers with the API,")
		fmt.Fprintln(os.Stderr, "and writes credentials + MCP config to disk.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	if *voucher == "" {
		fs.Usage()
		return fmt.Errorf("flag -voucher is required")
	}

	url := strings.TrimRight(*apiURL, "/")

	fmt.Fprintf(os.Stderr, "Generating Ed25519 keypair...\n")
	result, err := DoRegister(url, *voucher)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Registered as %s (fingerprint: %s)\n",
		result.Response.IdentityID, result.KeyPair.Fingerprint)

	if *jsonOut {
		return outputJSON(result)
	}

	// Write credentials
	credPath, err := WriteCredentials(result)
	if err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Credentials written to %s\n", credPath)

	// Write MCP config
	if !*noMCP {
		mcpConfig := BuildMcpConfig(url, result.Response.ClientID, result.Response.ClientSecret)
		mcpPath, err := WriteMcpConfig(mcpConfig, "")
		if err != nil {
			return fmt.Errorf("write MCP config: %w", err)
		}
		fmt.Fprintf(os.Stderr, "MCP config written to %s\n", mcpPath)
	}

	return nil
}

func outputJSON(result *RegisterResult) error {
	out := map[string]interface{}{
		"identity_id": result.Response.IdentityID,
		"fingerprint": result.KeyPair.Fingerprint,
		"public_key":  result.KeyPair.PublicKey,
		"private_key": result.KeyPair.PrivateKey,
		"client_id":   result.Response.ClientID,
		"client_secret": result.Response.ClientSecret,
		"api_url":     result.APIUrl,
		"mcp_url":     result.APIUrl + "/mcp",
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}
