package main

import (
	"context"
	"fmt"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// identityVerification is the result of checking the locally stored identity
// metadata against the server's record for the authenticating credential.
type identityVerification struct {
	IdentityID  string
	PublicKey   string
	Fingerprint string
}

// verifyIdentityAgainstServer confirms that the identity metadata in
// moltnet.json is the one the MoltNet API associates with the credential that
// just authenticated.
//
// The local document is not authoritative. An actor who can edit it can point
// the alias at a different identity ID, public key, or fingerprint, and nothing
// local can tell: the file is trusted by the same OS user that owns the
// provider. The server's record is the authority, so activation asks it.
//
// One nuance the issue's wording glosses over: this cannot run "before any
// secret resolution", because asking the server who we are requires
// authenticating, which resolves a credential. The circularity is unavoidable.
// What it does buy is that the *identity* metadata — the fingerprint that gets
// pinned into the activation cache, and the public key a signature is later
// checked against — is confirmed against the server before any of it is trusted
// or any seed material is used to sign.
//
// It authenticates through newAuthenticatedClient, so it uses whichever
// credential the agent actually uses for API calls: an agent_key_ref in
// preference to the OAuth2 client credentials. Verifying through a different
// credential than the one the agent works with would check the wrong binding,
// and #2160/#2171 move the daemon to an agent key only. The cost is that a
// keyring-backed agent_key_ref must be resolvable for a refresh to succeed.
func verifyIdentityAgainstServer(apiURL, credentialsPath string, creds *CredentialsFile) (*identityVerification, error) {
	client, err := newAuthenticatedClient(apiURL, credentialsPath)
	if err != nil {
		return nil, fmt.Errorf("verify identity: %w", err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		return nil, fmt.Errorf("verify identity: %w", formatTransportError(err))
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		return nil, fmt.Errorf("verify identity: %w", formatAPIError(res))
	}
	if whoami.SubjectType != moltnetapi.WhoamiSubjectTypeAgent {
		return nil, fmt.Errorf(
			"verify identity: the credential authenticated as %q, not as an agent",
			whoami.SubjectType,
		)
	}

	serverIdentityID := whoami.IdentityId.String()
	serverPublicKey := strings.TrimSpace(whoami.PublicKey.Or(""))
	serverFingerprint := strings.TrimSpace(whoami.Fingerprint.Or(""))

	// Compare every field the local document claims. A field the server does
	// not return is not evidence of agreement, so it is not silently accepted:
	// the ones that matter are required below.
	for _, field := range []struct {
		name   string
		local  string
		server string
	}{
		{"identity_id", strings.TrimSpace(creds.IdentityID), serverIdentityID},
		{"public key", strings.TrimSpace(creds.Keys.PublicKey), serverPublicKey},
		{"fingerprint", strings.TrimSpace(creds.Keys.Fingerprint), serverFingerprint},
	} {
		if field.server == "" {
			return nil, fmt.Errorf(
				"verify identity: the server returned no %s for this credential", field.name,
			)
		}
		if field.local == "" {
			continue
		}
		if field.local != field.server {
			return nil, fmt.Errorf(
				"verify identity: local %s does not match the server record for this credential.\n"+
					"  local:  %s\n"+
					"  server: %s\n"+
					"The identity document at %s describes a different identity than the one it "+
					"authenticates as. Re-run `moltnet config migrate` against the intended bundle, "+
					"or select the correct identity with `moltnet config identity select <alias>`.",
				field.name, field.local, field.server, credentialsPath,
			)
		}
	}

	return &identityVerification{
		IdentityID:  serverIdentityID,
		PublicKey:   serverPublicKey,
		Fingerprint: serverFingerprint,
	}, nil
}
