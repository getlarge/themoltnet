package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func publishIdentityAlias(
	ctx context.Context,
	apiURL, credentialsPath, alias string,
) (*moltnetapi.UpdateWhoamiResponse, error) {
	alias = strings.TrimSpace(alias)
	if err := validateAgentName(alias); err != nil {
		return nil, fmt.Errorf("invalid agent alias: %w", err)
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return nil, err
	}
	if creds == nil {
		return nil, fmt.Errorf("identity credentials not found: %s", credentialsPath)
	}

	client, err := newConfigAuthenticatedClient(
		apiURL,
		credentialsPath,
		NewSecretProviderRegistry(),
	)
	if err != nil {
		return nil, fmt.Errorf("publish identity alias: %w", err)
	}
	whoami, err := fetchAgentWhoami(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("publish identity alias: %w", err)
	}
	verified, err := verifyAuthenticatedSubject(
		credentialsPath,
		creds,
		whoami,
		true,
	)
	if err != nil {
		return nil, err
	}

	res, err := client.UpdateWhoami(
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
		return nil, fmt.Errorf("publish identity alias: the server updated a different agent record")
	}
	return updated, nil
}

func attemptIdentityAliasPublication(
	errOut io.Writer,
	apiURL, credentialsPath, alias string,
) {
	if _, err := publishIdentityAlias(
		context.Background(),
		apiURL,
		credentialsPath,
		alias,
	); err != nil {
		fmt.Fprintf(errOut, "Warning: agent alias publication failed: %v\n", err)
		fmt.Fprintf(errOut, "Recover with: moltnet config identity publish %s\n", alias)
		return
	}
	fmt.Fprintf(errOut, "Published network alias %s\n", alias)
}
