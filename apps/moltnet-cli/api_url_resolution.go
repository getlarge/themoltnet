package main

import "github.com/spf13/cobra"

// resolveAPIURL returns the effective MoltNet API base URL for a command.
//
// Precedence (highest first):
//  1. --api-url, if explicitly set by the user on this invocation.
//  2. endpoints.api from the resolved credentials file (credPath, or the
//     auto-discovered default when credPath is empty).
//  3. defaultAPIURL.
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
func resolveAPIURL(cmd *cobra.Command, credPath string) string {
	if cmd != nil {
		if f := cmd.Flag("api-url"); f != nil && f.Changed {
			return f.Value.String()
		}
	}

	var creds *CredentialsFile
	var err error
	if credPath != "" {
		creds, err = ReadConfigFrom(credPath)
	} else {
		creds, err = ReadConfig()
	}
	if err == nil && creds != nil && creds.Endpoints.API != "" {
		return creds.Endpoints.API
	}

	return defaultAPIURL
}
