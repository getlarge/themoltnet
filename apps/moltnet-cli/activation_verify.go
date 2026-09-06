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
// authenticating, which resolves the OAuth secret. The circularity is
// unavoidable. What it does buy is that the *identity* metadata — the
// fingerprint that gets pinned into the activation cache, and the public key a
// signature is later checked against — is confirmed against the server before
// any of it is trusted or any seed material is used to sign.
func verifyIdentityAgainstServer(apiURL, credentialsPath string, creds *CredentialsFile) (*identityVerification, error) {
	client, err := newIdentityVerificationClient(apiURL, credentialsPath, creds)
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

// newIdentityVerificationClient authenticates for the identity check.
//
// It prefers the OAuth2 client credentials over an agent_key_ref, which is the
// opposite of newAuthenticatedClient's order, and deliberately so. Activation
// is verifying the *identity* binding, and the OAuth2 client is the credential
// issued to that identity. An agent key is a bearer token that may be
// team-scoped and is meant for task work.
//
// The order also keeps activation from touching the OS keyring merely to record
// that an agent key lives there: resolving an agent_key_ref during every
// refresh would make activation require an unlocked keyring on hosts where the
// identity's own OAuth2 secret is already available.
//
// Configless setups have no OAuth2 client at all — the daemon and the GitHub
// Action authenticate with an agent key alone — so those fall through to the
// normal resolution order.
func newIdentityVerificationClient(
	apiURL, credentialsPath string,
	creds *CredentialsFile,
) (*moltnetapi.Client, error) {
	if creds == nil || creds.OAuth2.ClientID == "" {
		return newAuthenticatedClient(apiURL, credentialsPath)
	}
	clientSecret, err := resolveOAuth2Secret(creds, NewSecretProviderRegistry())
	if err != nil {
		return nil, fmt.Errorf("resolve OAuth2 client secret: %w", err)
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, clientSecret)
	return newBearerClient(
		apiURL,
		func(_ context.Context) (string, error) { return tm.GetToken() },
		tm.httpClient,
	)
}
