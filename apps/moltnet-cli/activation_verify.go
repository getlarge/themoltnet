package main

import (
	"context"
	"crypto/ed25519"
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
	whoami, err := fetchAgentWhoami(context.Background(), client)
	if err != nil {
		return nil, fmt.Errorf("verify identity: %w", err)
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

// fetchAgentWhoami reads the server's record for the credential that
// authenticated, and refuses anything that is not an agent.
func fetchAgentWhoami(ctx context.Context, client *moltnetapi.Client) (*moltnetapi.Whoami, error) {
	res, err := client.GetWhoami(ctx)
	if err != nil {
		return nil, formatTransportError(err)
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		// A rejected credential is the shape a revoked or rotated binding
		// takes: the server stops recognising it, and every later step would
		// fail with something less specific. Name it here rather than let a
		// bare 401 propagate.
		if _, unauthorized := res.(*moltnetapi.GetWhoamiUnauthorized); unauthorized {
			return nil, fmt.Errorf(
				"the server rejected this credential (%w).\n"+
					"It may have been revoked, rotated, or bound to a different identity. "+
					"Re-check the selected identity with `moltnet config identity list`, "+
					"or rotate with `moltnet agents credentials rotate`",
				formatAPIError(res),
			)
		}
		return nil, formatAPIError(res)
	}
	if whoami.SubjectType != moltnetapi.WhoamiSubjectTypeAgent {
		return nil, fmt.Errorf(
			"the credential authenticated as %q, not as an agent",
			whoami.SubjectType,
		)
	}
	return whoami, nil
}

// assertSigningIdentityMatchesServer refuses to sign with a seed that does not
// belong to the identity the request was authenticated as.
//
// assertSeedMatchesPublicKey already proves the seed derives keys.public_key,
// but that is the *local* claim: a document whose seed and public key agree
// with each other still signs as whoever the file says, which is not
// necessarily who the API just authenticated. The daemon has always compared
// against whoami (validateExecutorSigningIdentity); the CLI did not, so an
// agent could authenticate as one identity and sign as another.
func assertSigningIdentityMatchesServer(
	ctx context.Context,
	client *moltnetapi.Client,
	seed string,
) error {
	whoami, err := fetchAgentWhoami(ctx, client)
	if err != nil {
		return fmt.Errorf("verify signing identity: %w", err)
	}
	serverPublicKey := strings.TrimSpace(whoami.PublicKey.Or(""))
	serverFingerprint := strings.TrimSpace(whoami.Fingerprint.Or(""))
	if serverPublicKey == "" || serverFingerprint == "" {
		return fmt.Errorf(
			"verify signing identity: the server returned no public key or fingerprint for this credential",
		)
	}
	if err := assertSeedMatchesPublicKey(seed, serverPublicKey); err != nil {
		derived, derivedErr := deriveFingerprintFromSeed(seed)
		if derivedErr != nil {
			return fmt.Errorf("verify signing identity: %w", derivedErr)
		}
		return fmt.Errorf(
			"verify signing identity: the signing key does not belong to the authenticated identity "+
				"(authenticated %s, signing key derives %s).\n"+
				"The credential and the signing seed describe different identities; "+
				"select the intended one with `moltnet config identity select <alias>`.",
			serverFingerprint, derived,
		)
	}
	return nil
}

// deriveFingerprintFromSeed reports the fingerprint the seed actually carries,
// so a mismatch names both sides instead of only the expected one.
func deriveFingerprintFromSeed(seedB64 string) (string, error) {
	seed, err := decodeEd25519Seed(seedB64)
	if err != nil {
		return "", fmt.Errorf("signing seed is not a valid Ed25519 seed: %w", err)
	}
	return Fingerprint(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)), nil
}
