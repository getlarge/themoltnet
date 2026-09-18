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

func runTeamsJoinWithOptions(opts teamsJoinOpts) (returnErr error) {
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
		defer store.close(&returnErr)
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
			if conflict, ok := response.(*moltnetapi.ConflictProblemDetails); ok {
				return store.reconcileEnrollment(conflict)
			}
			switch response.(type) {
			case *moltnetapi.JoinTeamBadRequest, *moltnetapi.JoinTeamUnauthorized, *moltnetapi.JoinTeamForbidden, *moltnetapi.JoinTeamNotFound, *moltnetapi.JoinTeamGone, *moltnetapi.JoinTeamTooManyRequests:
				// A definitive rejection of this attempt permits pending cleanup.
				store.retainRecovery = false
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

// Key IDs and bindings are non-secret and identify the exact credential to revoke.
type enrollmentReconciliation struct {
	KeyID     string `json:"keyId"`
	SubjectID string `json:"subjectId"`
	TeamID    string `json:"teamId"`
}

func (t *agentKeyStoreTarget) reconcileEnrollment(problem *moltnetapi.ConflictProblemDetails) error {
	target, ok := problem.Conflict.Target.Get()
	if !ok || target.Resource != "agent-key" {
		return t.enrollmentOutcomeUnknown()
	}
	keys, ok := target.Keys.Get()
	if !ok || keys["keyId"] == "" || keys["subjectId"] != t.subjectID || keys["teamId"] == "" {
		return t.enrollmentOutcomeUnknown()
	}
	record := enrollmentReconciliation{KeyID: keys["keyId"], SubjectID: keys["subjectId"], TeamID: keys["teamId"]}
	if err := t.capture(agentKeyRecovery{Stage: "issued_secret_unavailable", CredentialsPath: t.credentialsPath, Reconciliation: &record}); err != nil {
		return fmt.Errorf("enrollment already issued key %s for team %s; revoke that exact key with authorized management credentials; could not update recovery file %s", record.KeyID, record.TeamID, t.recoveryPath)
	}
	return fmt.Errorf("enrollment already issued key %s for team %s; its secret cannot be recovered; revoke that exact key with authorized management credentials before using a fresh invitation; recovery file: %s", record.KeyID, record.TeamID, t.recoveryPath)
}

type rotationRecoveryRequest struct {
	APIURL         string `json:"apiUrl"`
	SubjectID      string `json:"subjectId"`
	KeyID          string `json:"keyId"`
	TeamID         string `json:"teamId,omitempty"`
	IdentityScoped bool   `json:"identityScoped"`
}

func (t *agentKeyStoreTarget) rotationOutcomeUnknown() error {
	return fmt.Errorf("rotation outcome is unknown; the old secret may already be invalid; retain protected recovery file %s and retry the same rotation request using independent management credentials to identify its replacement; do not rotate another key", t.recoveryPath)
}

// A completed rotation returns its exact successor without another issuance.
func (t *agentKeyStoreTarget) reconcileRotation(problem *moltnetapi.ConflictProblemDetails, previousKeyID string) error {
	target, ok := problem.Conflict.Target.Get()
	if !ok || target.Resource != "agent-key" {
		return t.rotationOutcomeUnknown()
	}
	keys, ok := target.Keys.Get()
	if !ok || keys["keyId"] == "" || keys["keyId"] == previousKeyID || keys["previousKeyId"] != previousKeyID || keys["subjectId"] != t.subjectID {
		return t.rotationOutcomeUnknown()
	}
	if t.expectedIdentity {
		if keys["bindingScope"] != "identity" || keys["teamId"] != "" {
			return t.rotationOutcomeUnknown()
		}
	} else if keys["bindingScope"] != "team" || keys["teamId"] != t.expectedTeam {
		return t.rotationOutcomeUnknown()
	}
	record := enrollmentReconciliation{KeyID: keys["keyId"], SubjectID: keys["subjectId"], TeamID: keys["teamId"]}
	if err := t.capture(agentKeyRecovery{Stage: "rotated_secret_unavailable", CredentialsPath: t.credentialsPath, Reconciliation: &record}); err != nil {
		return fmt.Errorf("rotation already issued replacement key %s; revoke that exact key with authorized management credentials; could not update recovery file %s", record.KeyID, t.recoveryPath)
	}
	return fmt.Errorf("rotation already issued replacement key %s; its secret cannot be recovered; revoke that exact key with authorized management credentials; recovery file: %s", record.KeyID, t.recoveryPath)
}
