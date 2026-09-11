package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// identityPublishTimeout bounds automatic publication in flows that have no
// timeout of their own (registration).
const identityPublishTimeout = 15 * time.Second

// publishIdentityAlias publishes alias as the network alias of the agent that
// creds authenticates as. It refuses to write unless the server's record for
// the credential matches the local document, and it does not write at all
// when the network alias already has that value.
func publishIdentityAlias(
	ctx context.Context,
	apiURL, credentialsPath string,
	creds *CredentialsFile,
	alias string,
) (*moltnetapi.UpdateWhoamiResponse, error) {
	alias = strings.TrimSpace(alias)
	if err := validateAgentName(alias); err != nil {
		return nil, fmt.Errorf("invalid agent alias: %w", err)
	}
	if creds == nil {
		return nil, fmt.Errorf("identity credentials not found: %s", credentialsPath)
	}
	// verifyAuthenticatedSubject skips the fingerprint comparison when the
	// local value is empty. Publishing must not rely on that leniency.
	if strings.TrimSpace(creds.Keys.Fingerprint) == "" {
		return nil, &subjectVerificationError{err: fmt.Errorf(
			"publish identity alias: %s has no signing key fingerprint",
			credentialsPath,
		)}
	}

	identity, err := authenticateConfigIdentity(
		ctx,
		apiURL,
		credentialsPath,
		creds,
		NewSecretProviderRegistry(),
		true,
	)
	if err != nil {
		return nil, fmt.Errorf("publish identity alias: %w", err)
	}
	verified := identity.verified
	if current, ok := identity.whoami.Alias.Get(); ok && current == alias {
		return &moltnetapi.UpdateWhoamiResponse{
			SubjectId:   identity.whoami.SubjectId,
			Fingerprint: verified.Fingerprint,
			Alias:       current,
		}, nil
	}

	res, err := identity.client.UpdateWhoami(
		ctx,
		&moltnetapi.UpdateWhoamiReq{Alias: alias},
	)
	if err != nil {
		return nil, fmt.Errorf("publish identity alias: %w", formatTransportError(err))
	}
	updated, ok := res.(*moltnetapi.UpdateWhoamiResponse)
	if !ok {
		return nil, fmt.Errorf("publish identity alias: %w", formatAPIError(res))
	}
	if updated.SubjectId.String() != verified.SubjectID ||
		updated.Fingerprint != verified.Fingerprint {
		return nil, &subjectVerificationError{err: errors.New(
			"publish identity alias: the server updated a different agent record",
		)}
	}
	return updated, nil
}

// attemptIdentityAliasPublication publishes the network alias as a
// best-effort step after the identity has been stored. A failure is reported
// on errOut and never fails the surrounding command.
func attemptIdentityAliasPublication(
	errOut io.Writer,
	apiURL, credentialsPath, alias string,
	timeout time.Duration,
) {
	if timeout <= 0 {
		timeout = identityPublishTimeout
	}
	err := func() error {
		creds, err := ReadConfigFrom(credentialsPath)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		_, err = publishIdentityAlias(ctx, apiURL, credentialsPath, creds, alias)
		return err
	}()
	if err == nil {
		fmt.Fprintf(errOut, "Published network alias %s\n", alias)
		return
	}

	fmt.Fprintf(errOut, "Warning: network alias publication failed: %v\n", err)
	var verificationErr *subjectVerificationError
	status, hasStatus := apiErrorStatus(err)
	switch {
	case errors.As(err, &verificationErr):
		// The credential and the local identity disagree; a retry would
		// fail the same way.
	case hasStatus && (status == http.StatusUnauthorized || status == http.StatusForbidden):
		fmt.Fprintf(
			errOut,
			"Check the credential with: moltnet config identity show %s (only the primary credential can publish)\n",
			alias,
		)
	default:
		fmt.Fprintf(errOut, "Recover with: moltnet config identity publish %s\n", alias)
	}
}
