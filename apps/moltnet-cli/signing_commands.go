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
	client, err := newAuthenticatedClient(opts.apiURL, opts.credPath)
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
		teamID, err := parseTeamID(opts.teamID)
		if err != nil {
			return err
		}
		constraint, err := signingRequestConstraint(opts.constraintType, opts.constraintID)
		if err != nil {
			return err
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

func signingRequestConstraint(
	constraintType, constraintID string,
) (moltnetapi.CreateSigningRequestReqSignerConstraint, error) {
	switch constraintType {
	case "human":
		id, err := uuid.Parse(constraintID)
		if err != nil {
			return moltnetapi.CreateSigningRequestReqSignerConstraint{},
				fmt.Errorf("invalid human --constraint-id: %w", err)
		}
		return moltnetapi.NewProvenanceGraphHumanNodeCreateSigningRequestReqSignerConstraint(
			moltnetapi.ProvenanceGraphHumanNode{
				ID:   id,
				Type: moltnetapi.ProvenanceGraphHumanNodeTypeHuman,
			},
		), nil
	case "team-role":
		role := moltnetapi.ProvenanceGraphTeamRoleNodeID(constraintID)
		// MarshalText validates enum membership.
		if _, err := role.MarshalText(); err != nil {
			return moltnetapi.CreateSigningRequestReqSignerConstraint{},
				fmt.Errorf("invalid team role --constraint-id: %w", err)
		}
		return moltnetapi.NewProvenanceGraphTeamRoleNodeCreateSigningRequestReqSignerConstraint(
			moltnetapi.ProvenanceGraphTeamRoleNode{
				ID:   role,
				Type: moltnetapi.ProvenanceGraphTeamRoleNodeTypeTeamRole,
			},
		), nil
	case "group":
		id, err := uuid.Parse(constraintID)
		if err != nil {
			return moltnetapi.CreateSigningRequestReqSignerConstraint{},
				fmt.Errorf("invalid group --constraint-id: %w", err)
		}
		return moltnetapi.NewProvenanceGraphGroupNodeCreateSigningRequestReqSignerConstraint(
			moltnetapi.ProvenanceGraphGroupNode{
				ID:   id,
				Type: moltnetapi.ProvenanceGraphGroupNodeTypeGroup,
			},
		), nil
	default:
		return moltnetapi.CreateSigningRequestReqSignerConstraint{},
			fmt.Errorf("invalid --constraint-type %q", constraintType)
	}
}

func runSigningRequestListCmd(apiURL, credPath, scope string, out io.Writer) error {
	client, err := newAuthenticatedClient(apiURL, credPath)
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
	client, err := newAuthenticatedClient(apiURL, credPath)
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
	team, err := parseTeamID(teamID)
	if err != nil {
		return err
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
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

func runSigningCredentialGetCmd(apiURL, credPath, teamID, id string, out io.Writer) error {
	team, err := parseTeamID(teamID)
	if err != nil {
		return err
	}
	credentialID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid signing credential ID: %w", err)
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetSigningCredential(
		context.Background(),
		moltnetapi.GetSigningCredentialParams{
			ID: credentialID, XMoltnetTeamID: team,
		},
	)
	if err != nil {
		return fmt.Errorf("get signing credential: %w", formatTransportError(err))
	}
	credential, ok := res.(*moltnetapi.SigningCredential)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(out, credential)
}

func runSigningCredentialActionCmd(apiURL, credPath, teamID, id, action string, out io.Writer) error {
	team, err := parseTeamID(teamID)
	if err != nil {
		return err
	}
	credentialID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid signing credential ID: %w", err)
	}
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	var res any
	switch action {
	case "approve":
		res, err = client.ApproveSigningCredential(
			context.Background(),
			moltnetapi.NewOptApproveSigningCredentialReq(moltnetapi.ApproveSigningCredentialReq{}),
			moltnetapi.ApproveSigningCredentialParams{
				ID: credentialID, XMoltnetTeamID: team,
			},
		)
	case "suspend":
		res, err = client.SuspendSigningCredential(
			context.Background(),
			moltnetapi.NewOptSuspendSigningCredentialReq(moltnetapi.SuspendSigningCredentialReq{}),
			moltnetapi.SuspendSigningCredentialParams{
				ID: credentialID, XMoltnetTeamID: team,
			},
		)
	case "revoke":
		res, err = client.RevokeSigningCredential(
			context.Background(),
			moltnetapi.NewOptRevokeSigningCredentialReq(moltnetapi.RevokeSigningCredentialReq{}),
			moltnetapi.RevokeSigningCredentialParams{
				ID: credentialID, XMoltnetTeamID: team,
			},
		)
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
