package main

import (
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// resolveAPIURL returns the effective MoltNet API base URL for a command.
//
// Precedence (highest first):
//  1. --api-url, if explicitly set by the user on this invocation.
//  2. MOLTNET_API_URL, if non-blank.
//  3. endpoints.api from the resolved credentials file. credPath is resolved
//     through resolveCredentialsPath, the same canonical selection
//     loadCredentials uses, so a command's endpoint and its identity always
//     come from one credentials file (issue #2129).
//  4. defaultAPIURL.
//
// This exists so the credentials file is self-contained: an agent bootstrapped
// against a non-default API (e.g. localhost) does not need to also remember
// `--api-url` on every invocation. The credentials file already records
// endpoints.api at registration time; the CLI is the lone caller that used to
// ignore it (issue #1145).
//
// Failures to read or parse credentials are deliberately swallowed and treated
// as "no override" — resolveAPIURL is called on the hot path of every
// authenticated command and must never fail loudly when credentials are
// missing or malformed. Downstream code already surfaces credential errors
// with actionable messages (e.g. loadCredentials → "run 'moltnet register'").
// Swallowing falls back to defaultAPIURL, never to a different credentials
// file, so an unreadable activated config cannot redirect a command at the
// global agent's endpoint.
func resolveAPIURL(cmd *cobra.Command, credPath string) string {
	if cmd != nil {
		if f := cmd.Flag("api-url"); f != nil && f.Changed {
			return f.Value.String()
		}
	}
	if apiURL := strings.TrimSpace(os.Getenv(apiURLEnv)); apiURL != "" {
		return apiURL
	}

	resolved, err := resolveCredentialsPath(credPath)
	if err != nil {
		return defaultAPIURL
	}
	creds, err := ReadConfigFrom(resolved)
	if err == nil && creds != nil && creds.Endpoints.API != "" {
		return creds.Endpoints.API
	}

	return defaultAPIURL
}

func resolveAPIURLFromCredentials(
	explicitURL string,
	explicit bool,
	creds *CredentialsFile,
) string {
	if explicit {
		return explicitURL
	}
	if apiURL := strings.TrimSpace(os.Getenv(apiURLEnv)); apiURL != "" {
		return apiURL
	}
	if creds != nil {
		if apiURL := strings.TrimSpace(creds.Endpoints.API); apiURL != "" {
			return apiURL
		}
	}
	return defaultAPIURL
}
