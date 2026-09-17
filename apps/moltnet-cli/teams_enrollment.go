package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type teamsJoinOpts struct {
	apiURL, credPath, code, idempotencyKey string
	issueAgentKey                          bool
	store                                  agentKeyStoreOpts
	out, errOut                            io.Writer
}

func runTeamsJoinWithOptions(opts teamsJoinOpts) error {
	if opts.store.enabled && !opts.issueAgentKey {
		return fmt.Errorf("--store requires --issue-agent-key")
	}
	if opts.issueAgentKey && strings.TrimSpace(opts.idempotencyKey) == "" {
		return fmt.Errorf("--issue-agent-key requires --idempotency-key; retain it for retries")
	}
	store, err := prepareAgentKeyStore(opts.store, opts.credPath)
	if err != nil {
		return err
	}
	if store != nil {
		store.enrollment = true
		if err := store.reserve(); err != nil {
			return err
		}
		defer store.close()
	}
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	request := &moltnetapi.JoinTeamReq{Code: opts.code}
	params := moltnetapi.JoinTeamParams{}
	if opts.issueAgentKey {
		request.IssueAgentKey = moltnetapi.NewOptJoinTeamReqIssueAgentKey(moltnetapi.JoinTeamReqIssueAgentKeyTrue)
		params.IdempotencyKey = moltnetapi.NewOptString(opts.idempotencyKey)
	}
	response, err := client.JoinTeam(context.Background(), request, params)
	if err != nil {
		return fmt.Errorf("teams join: %w", formatTransportError(err))
	}
	result, ok := response.(*moltnetapi.JoinTeamOK)
	if !ok {
		return formatAPIError(response)
	}
	if !opts.issueAgentKey {
		// Membership-only output is never secret-bearing, even if a future server
		// accidentally adds credential fields to this response.
		return printJSONTo(opts.out, struct {
			TeamID string `json:"teamId"`
			Role   string `json:"role"`
		}{result.TeamId.String(), string(result.Role)})
	}
	issued, ok := result.AgentKey.Get()
	if !ok {
		return fmt.Errorf("enrollment did not return an agent key")
	}
	if store != nil {
		store.expectedTeam = result.TeamId.String()
		return store.persist(opts.out, opts.errOut, storedAgentKeyOutput{Key: issued.Key, TeamID: result.TeamId.String(), Role: string(result.Role), IdempotencyKey: opts.idempotencyKey}, issued.Secret)
	}
	writeSecretNotice(opts.errOut)
	return printJSONTo(opts.out, result)
}
