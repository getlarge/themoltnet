package main

import (
	"context"
	"fmt"
	"io"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

type agentEnrollmentCreateOpts struct {
	apiURL           string
	credPath         string
	teamID           string
	expiresInMinutes int
	expiresSet       bool
	out              io.Writer
}

func runAgentEnrollmentCreateCmd(opts agentEnrollmentCreateOpts) error {
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	teamID, err := uuid.Parse(opts.teamID)
	if err != nil {
		return fmt.Errorf("invalid --team-id %q: %w", opts.teamID, err)
	}
	request := moltnetapi.CreateAgentEnrollmentReq{}
	if opts.expiresSet {
		request.ExpiresInMinutes = moltnetapi.NewOptInt(opts.expiresInMinutes)
	}
	response, err := client.CreateAgentEnrollment(
		context.Background(),
		moltnetapi.NewOptCreateAgentEnrollmentReq(request),
		moltnetapi.CreateAgentEnrollmentParams{XMoltnetTeamID: teamID},
	)
	if err != nil {
		return fmt.Errorf("agents enrollments create: %w", formatTransportError(err))
	}
	enrollment, ok := response.(*moltnetapi.CreatedAgentEnrollment)
	if !ok {
		return formatAPIError(response)
	}
	return printJSONTo(opts.out, enrollment)
}

func runAgentEnrollmentRevokeCmd(apiURL, credPath, team, enrollment string) error {
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	teamID, err := uuid.Parse(team)
	if err != nil {
		return fmt.Errorf("invalid --team-id %q: %w", team, err)
	}
	enrollmentID, err := uuid.Parse(enrollment)
	if err != nil {
		return fmt.Errorf("invalid enrollment ID %q: %w", enrollment, err)
	}
	response, err := client.RevokeAgentEnrollment(
		context.Background(),
		moltnetapi.RevokeAgentEnrollmentParams{ID: enrollmentID, XMoltnetTeamID: teamID},
	)
	if err != nil {
		return fmt.Errorf("agents enrollments revoke: %w", formatTransportError(err))
	}
	if _, ok := response.(*moltnetapi.RevokeAgentEnrollmentNoContent); !ok {
		return formatAPIError(response)
	}
	return nil
}
