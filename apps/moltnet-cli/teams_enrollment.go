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

// Contains the exact retry input, including the invitation bearer code. This
// lives only in the mode-0600 recovery artifact, never in command output.
type enrollmentRecoveryRequest struct {
	APIURL         string `json:"apiUrl"`
	SubjectID      string `json:"subjectId"`
	Code           string `json:"code"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (t *agentKeyStoreTarget) enrollmentOutcomeUnknown() error {
	return fmt.Errorf("enrollment issuance outcome is unknown; retain the protected recovery file %s and retry only the same API, identity, invitation code and idempotency key recorded there; if replay returns 409, reconcile and revoke the previously issued key before using a fresh invitation (its secret cannot be recovered)", t.recoveryPath)
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
	if store != nil {
		if err := store.capture(agentKeyRecovery{
			Stage: "issuance_outcome_unknown", CredentialsPath: store.credentialsPath,
			Enrollment: &enrollmentRecoveryRequest{APIURL: opts.apiURL, SubjectID: store.subjectID, Code: opts.code, IdempotencyKey: opts.idempotencyKey},
		}); err != nil {
			return fmt.Errorf("could not persist enrollment retry context; issuance was not attempted")
		}
	}
	response, err := client.JoinTeam(context.Background(), request, params)
	if err != nil {
		if store != nil {
			return store.enrollmentOutcomeUnknown()
		}
		return fmt.Errorf("teams join: %w", formatTransportError(err))
	}
	result, ok := response.(*moltnetapi.JoinTeamOK)
	if !ok {
		if store != nil {
			switch response.(type) {
			case *moltnetapi.JoinTeamBadRequest, *moltnetapi.JoinTeamUnauthorized, *moltnetapi.JoinTeamForbidden, *moltnetapi.JoinTeamNotFound, *moltnetapi.JoinTeamGone, *moltnetapi.JoinTeamTooManyRequests:
				// A definitive rejection of this attempt permits pending cleanup.
				store.captured = false
			default:
				return store.enrollmentOutcomeUnknown()
			}
		}
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
		if store != nil {
			return store.enrollmentOutcomeUnknown()
		}
		return fmt.Errorf("enrollment did not return an agent key")
	}
	if store != nil {
		store.expectedTeam = result.TeamId.String()
		return store.persist(opts.out, opts.errOut, storedAgentKeyOutput{Key: issued.Key, TeamID: result.TeamId.String(), Role: string(result.Role), IdempotencyKey: opts.idempotencyKey}, issued.Secret)
	}
	writeSecretNotice(opts.errOut)
	return printJSONTo(opts.out, result)
}
