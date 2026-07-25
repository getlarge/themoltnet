package main

import (
	"context"
	"fmt"
	"io"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

type signingRequestCreateOpts struct {
	apiURL, credPath, message, method, teamID, purpose, constraintType, constraintID string
	out                                                                              io.Writer
}

func runSigningRequestCreateCmd(opts signingRequestCreateOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateSigningRequestReq{Message: opts.message}
	switch opts.method {
	case "", "agent-ed25519":
		req.VerificationMethod = moltnetapi.NewOptCreateSigningRequestReqVerificationMethod(
			moltnetapi.CreateSigningRequestReqVerificationMethodAgentEd25519,
		)
	case "human-hardware-previewsign":
		if opts.teamID == "" || opts.purpose == "" || opts.constraintType == "" {
			return fmt.Errorf("delegated signing requires --team-id, --purpose, and --constraint-type")
		}
		teamID, err := uuid.Parse(opts.teamID)
		if err != nil {
			return fmt.Errorf("invalid --team-id: %w", err)
		}
		constraintType := moltnetapi.CreateSigningRequestReqSignerConstraintType(opts.constraintType)
		if _, err := constraintType.MarshalText(); err != nil {
			return fmt.Errorf("invalid --constraint-type: %w", err)
		}
		constraint := moltnetapi.CreateSigningRequestReqSignerConstraint{Type: constraintType}
		if opts.constraintID != "" {
			constraint.ID = moltnetapi.NewOptString(opts.constraintID)
		}
		req.VerificationMethod = moltnetapi.NewOptCreateSigningRequestReqVerificationMethod(
			moltnetapi.CreateSigningRequestReqVerificationMethodHumanHardwarePreviewsign,
		)
		req.TeamId = moltnetapi.NewOptUUID(teamID)
		req.Purpose = moltnetapi.NewOptString(opts.purpose)
		req.SignerConstraint = moltnetapi.NewOptCreateSigningRequestReqSignerConstraint(constraint)
	default:
		return fmt.Errorf("unsupported verification method %q", opts.method)
	}
	res, err := client.CreateSigningRequest(context.Background(), req)
	if err != nil {
		return fmt.Errorf("create signing request: %w", formatTransportError(err))
	}
	request, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, request)
}

func runSigningRequestListCmd(apiURL, credPath, scope string, out io.Writer) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	params := moltnetapi.ListSigningRequestsParams{}
	if scope != "" {
		value := moltnetapi.ListSigningRequestsScope(scope)
		if _, err := value.MarshalText(); err != nil {
			return fmt.Errorf("invalid --scope: %w", err)
		}
		params.Scope = moltnetapi.NewOptListSigningRequestsScope(value)
	}
	res, err := client.ListSigningRequests(context.Background(), params)
	if err != nil {
		return fmt.Errorf("list signing requests: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.SigningRequestList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(out, list)
}

func runSigningRequestGetCmd(apiURL, credPath, id string, out io.Writer) error {
	requestID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid signing request ID: %w", err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetSigningRequest(context.Background(), moltnetapi.GetSigningRequestParams{ID: requestID})
	if err != nil {
		return fmt.Errorf("get signing request: %w", formatTransportError(err))
	}
	request, ok := res.(*moltnetapi.SigningRequest)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(out, request)
}

func runSigningCredentialListCmd(apiURL, credPath, teamID string, out io.Writer) error {
	team, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid --team-id: %w", err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListSigningCredentials(context.Background(), moltnetapi.ListSigningCredentialsParams{
		XMoltnetTeamID: team,
	})
	if err != nil {
		return fmt.Errorf("list signing credentials: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.SigningCredentialList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(out, list)
}

func runSigningCredentialActionCmd(apiURL, credPath, teamID, id, action string, out io.Writer) error {
	team, err := uuid.Parse(teamID)
	if err != nil {
		return fmt.Errorf("invalid --team-id: %w", err)
	}
	credentialID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid signing credential ID: %w", err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	var res any
	switch action {
	case "approve":
		res, err = client.ApproveSigningCredential(context.Background(), moltnetapi.ApproveSigningCredentialParams{
			ID: credentialID, XMoltnetTeamID: team,
		})
	case "suspend":
		res, err = client.SuspendSigningCredential(context.Background(), moltnetapi.SuspendSigningCredentialParams{
			ID: credentialID, XMoltnetTeamID: team,
		})
	case "revoke":
		res, err = client.RevokeSigningCredential(context.Background(), moltnetapi.RevokeSigningCredentialParams{
			ID: credentialID, XMoltnetTeamID: team,
		})
	default:
		return fmt.Errorf("unsupported credential action %q", action)
	}
	if err != nil {
		return fmt.Errorf("%s signing credential: %w", action, formatTransportError(err))
	}
	credential, ok := res.(*moltnetapi.SigningCredential)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(out, credential)
}
