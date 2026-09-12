package main

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// subjectVerification is the server record for the authenticating credential.
// SubjectID and SubjectType are the durable authorization anchor. The identity
// and key fields are current, rotatable attributes returned for callers that
// need to refresh derived local metadata.
type subjectVerification struct {
	SubjectID   string
	SubjectType SubjectType
	PublicKey   string
	Fingerprint string
}

// verifyIdentityAgainstServer confirms that the subject tuple in moltnet.json
// is the one the MoltNet API associates with the credential that authenticated.
//
// The local document is not authoritative. An actor who can edit it can point
// the alias at a different subject, and nothing local can tell: the file is
// trusted by the same OS user that owns the provider. The server's record is
// the authority, so activation asks it.
//
// One nuance the issue's wording glosses over: this cannot run "before any
// secret resolution", because asking the server who we are requires
// authenticating, which resolves a credential. The circularity is unavoidable.
// What it does buy is that the durable subject is confirmed against the server
// before it is pinned, while current identity/key metadata can be refreshed as
// rotatable attributes.
//
// Activation verifies the credential selected for ordinary CLI work. When the
// document also contains an agent_key_ref, it verifies that daemon credential
// independently and requires both credentials to identify the same subject.
func verifyIdentityAgainstServer(apiURL, credentialsPath string, creds *CredentialsFile) (*subjectVerification, error) {
	registry := NewSecretProviderRegistry()
	client, err := newConfigAuthenticatedClient(apiURL, credentialsPath, registry)
	if err != nil {
		return nil, fmt.Errorf("verify identity: %w", err)
	}
	whoami, err := fetchAgentWhoami(context.Background(), client)
	if err != nil {
		return nil, fmt.Errorf("verify identity: %w", err)
	}

	verified, err := verifyAuthenticatedSubject(credentialsPath, creds, whoami, true)
	if err != nil {
		return nil, err
	}
	if !hasOAuth2Configuration(creds) || creds.AgentKeyRef == nil {
		return verified, nil
	}

	configKey, _, err := resolveAgentKey(creds, registry)
	if err != nil {
		return nil, fmt.Errorf("verify daemon identity: resolve agent_key_ref: %w", err)
	}
	keyClient, err := newAgentKeyAuthenticatedClient(apiURL, configKey)
	if err != nil {
		return nil, fmt.Errorf("verify daemon identity: %w", err)
	}
	keyWhoami, err := fetchAgentWhoami(context.Background(), keyClient)
	if err != nil {
		return nil, fmt.Errorf("verify daemon identity: %w", err)
	}
	keyVerified, err := verifyAuthenticatedSubject(credentialsPath, creds, keyWhoami, true)
	if err != nil {
		return nil, fmt.Errorf("verify daemon identity: %w", err)
	}
	if keyVerified.SubjectID != verified.SubjectID {
		return nil, fmt.Errorf(
			"verify identity: OAuth2 and agent_key_ref authenticate as different subjects (%s and %s)",
			verified.SubjectID,
			keyVerified.SubjectID,
		)
	}
	return verified, nil
}

// verifyConfigIdentityAgainstServer is the migration variant of identity
// verification. It resolves only references from the supplied document and
// registry, preventing an ambient agent-key override from authenticating a
// different subject while the plan is being bound.
func verifyConfigIdentityAgainstServer(apiURL, credentialsPath string, creds *CredentialsFile, registry *SecretProviderRegistry, verifySigningKey bool) (*subjectVerification, error) {
	identity, err := authenticateConfigIdentity(context.Background(), apiURL, credentialsPath, creds, registry, verifySigningKey)
	if err != nil {
		return nil, err
	}
	return identity.verified, nil
}

// authenticatedConfigIdentity is a client whose credential has been verified
// against the local document, kept together with the server record it was
// verified against so a caller can act on the same authentication.
type authenticatedConfigIdentity struct {
	client   *moltnetapi.Client
	whoami   *moltnetapi.Whoami
	verified *subjectVerification
}

// subjectVerificationError marks a failure where the server's record for the
// credential and the local document disagree, or the document cannot prove
// the binding. Retrying the same request cannot fix it.
type subjectVerificationError struct {
	err error
}

func (e *subjectVerificationError) Error() string { return e.err.Error() }
func (e *subjectVerificationError) Unwrap() error { return e.err }

// authenticateConfigIdentity is verifyConfigIdentityAgainstServer for callers
// that go on to use the authenticated client.
func authenticateConfigIdentity(
	ctx context.Context,
	apiURL, credentialsPath string,
	creds *CredentialsFile,
	registry *SecretProviderRegistry,
	verifySigningKey bool,
) (*authenticatedConfigIdentity, error) {
	client, err := newConfigAuthenticatedClient(apiURL, credentialsPath, registry)
	if err != nil {
		return nil, fmt.Errorf("verify config identity: %w", err)
	}
	whoami, err := fetchAgentWhoami(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("verify config identity: %w", err)
	}
	verified, err := verifyAuthenticatedSubject(credentialsPath, creds, whoami, verifySigningKey)
	if err != nil {
		return nil, &subjectVerificationError{err: err}
	}
	return &authenticatedConfigIdentity{client: client, whoami: whoami, verified: verified}, nil
}

// verifyAuthenticatedSubject is shared by activation and config migration so
// their definition of the durable binding cannot drift. Legacy documents have
// no subject tuple to compare; authentication supplies it. Canonical documents
// must match it exactly. Ory identity may rotate independently, but the local
// signing key must match the authenticated agent because the corresponding
// private seed cannot be recovered from the server record.
func verifyAuthenticatedSubject(
	credentialsPath string,
	creds *CredentialsFile,
	whoami *moltnetapi.Whoami,
	verifySigningKey bool,
) (*subjectVerification, error) {
	serverSubjectID := whoami.SubjectId.String()
	serverSubjectType := SubjectType(whoami.SubjectType)
	serverPublicKey := strings.TrimSpace(whoami.PublicKey.Or(""))
	serverFingerprint := strings.TrimSpace(whoami.Fingerprint.Or(""))
	if whoami.SubjectId == uuid.Nil {
		return nil, fmt.Errorf("verify identity: the server returned no subject_id for this credential")
	}
	if serverSubjectType != SubjectTypeAgent {
		return nil, fmt.Errorf(
			"verify identity: the credential authenticated as %q, not as an agent",
			whoami.SubjectType,
		)
	}

	localSubjectID := strings.TrimSpace(creds.SubjectID)
	localSubjectType := creds.SubjectType
	if localSubjectID != "" || localSubjectType != "" {
		if localSubjectID == "" || localSubjectType != SubjectTypeAgent {
			return nil, fmt.Errorf(
				"verify identity: %s has an incomplete or unsupported subject anchor",
				credentialsPath,
			)
		}
		if localSubjectID != serverSubjectID {
			return nil, fmt.Errorf(
				"verify identity: local subject_id does not match the server record for this credential.\n"+
					"  local:  %s\n"+
					"  server: %s\n"+
					"Select the correct identity with `moltnet config identity select <alias>`.",
				localSubjectID, serverSubjectID,
			)
		}
	}
	if serverPublicKey == "" || serverFingerprint == "" {
		return nil, fmt.Errorf(
			"verify identity: the server returned no public key or fingerprint for this credential",
		)
	}
	if verifySigningKey {
		localPublicKey := strings.TrimSpace(creds.Keys.PublicKey)
		localFingerprint := strings.TrimSpace(creds.Keys.Fingerprint)
		if localPublicKey != "" && localPublicKey != serverPublicKey {
			return nil, fmt.Errorf("verify identity: local public key does not match the authenticated agent")
		}
		if localFingerprint != "" && localFingerprint != serverFingerprint {
			return nil, fmt.Errorf("verify identity: local fingerprint does not match the authenticated agent")
		}
	}

	return &subjectVerification{
		SubjectID:   serverSubjectID,
		SubjectType: serverSubjectType,
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
