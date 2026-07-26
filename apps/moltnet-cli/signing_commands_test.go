package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

type stubSigningCommandsHandler struct {
	moltnetapi.UnimplementedHandler
	createdRequest *moltnetapi.CreateSigningRequestReq
	requestList    moltnetapi.ListSigningRequestsParams
	credentialList moltnetapi.ListSigningCredentialsParams
	action         string
}

var (
	signingCommandRequestID    = uuid.MustParse("00000000-0000-0000-0000-000000000101")
	signingCommandCredentialID = uuid.MustParse("00000000-0000-0000-0000-000000000102")
	signingCommandTeamID       = uuid.MustParse("00000000-0000-0000-0000-000000000103")
)

func signingCommandRequest() *moltnetapi.SigningRequest {
	return &moltnetapi.SigningRequest{
		ID:                 signingCommandRequestID,
		AgentId:            uuid.New(),
		Message:            "approve release",
		Nonce:              uuid.New(),
		SigningInput:       "cGF5bG9hZA==",
		Status:             moltnetapi.SigningRequestStatusPending,
		VerificationMethod: moltnetapi.SigningRequestVerificationMethodHumanHardwarePreviewsign,
		CreatedAt:          time.Now(),
		ExpiresAt:          time.Now().Add(time.Minute),
	}
}

func signingCommandCredential() *moltnetapi.SigningCredential {
	owner := moltnetapi.NewHumanPrincipalSigningCredentialOwner(
		moltnetapi.HumanPrincipal{
			HumanId: uuid.New(),
			Kind:    moltnetapi.HumanPrincipalKindHuman,
		},
	)
	return &moltnetapi.SigningCredential{
		ID:                 signingCommandCredentialID,
		TeamId:             signingCommandTeamID,
		Owner:              owner,
		VerificationMethod: moltnetapi.SigningCredentialVerificationMethodHumanHardwarePreviewsign,
		CredentialType:     "platform-key",
		Algorithm:          "p256",
		Label:              "Laptop key",
		Status:             moltnetapi.SigningCredentialStatusActive,
		PublicMaterial:     moltnetapi.SigningCredentialPublicMaterial{Version: 1},
		EnrollmentEvidence: moltnetapi.SigningCredentialEnrollmentEvidence{Version: 1},
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}
}

func (h *stubSigningCommandsHandler) CreateSigningRequest(
	_ context.Context,
	req *moltnetapi.CreateSigningRequestReq,
) (moltnetapi.CreateSigningRequestRes, error) {
	h.createdRequest = req
	return signingCommandRequest(), nil
}

func (h *stubSigningCommandsHandler) ListSigningRequests(
	_ context.Context,
	params moltnetapi.ListSigningRequestsParams,
) (moltnetapi.ListSigningRequestsRes, error) {
	h.requestList = params
	return &moltnetapi.SigningRequestList{
		Items: []moltnetapi.SigningRequest{*signingCommandRequest()},
		Total: 1,
		Limit: 20,
	}, nil
}

func (h *stubSigningCommandsHandler) GetSigningRequest(
	_ context.Context,
	_ moltnetapi.GetSigningRequestParams,
) (moltnetapi.GetSigningRequestRes, error) {
	return signingCommandRequest(), nil
}

func (h *stubSigningCommandsHandler) ListSigningCredentials(
	_ context.Context,
	params moltnetapi.ListSigningCredentialsParams,
) (moltnetapi.ListSigningCredentialsRes, error) {
	h.credentialList = params
	return &moltnetapi.SigningCredentialList{
		Items: []moltnetapi.SigningCredential{*signingCommandCredential()},
		Total: 1,
		Limit: 20,
	}, nil
}

func (h *stubSigningCommandsHandler) GetSigningCredential(
	_ context.Context,
	_ moltnetapi.GetSigningCredentialParams,
) (moltnetapi.GetSigningCredentialRes, error) {
	return signingCommandCredential(), nil
}

func (h *stubSigningCommandsHandler) ApproveSigningCredential(
	_ context.Context,
	_ moltnetapi.OptApproveSigningCredentialReq,
	_ moltnetapi.ApproveSigningCredentialParams,
) (moltnetapi.ApproveSigningCredentialRes, error) {
	h.action = "approve"
	return signingCommandCredential(), nil
}

func (h *stubSigningCommandsHandler) SuspendSigningCredential(
	_ context.Context,
	_ moltnetapi.OptSuspendSigningCredentialReq,
	_ moltnetapi.SuspendSigningCredentialParams,
) (moltnetapi.SuspendSigningCredentialRes, error) {
	h.action = "suspend"
	return signingCommandCredential(), nil
}

func (h *stubSigningCommandsHandler) RevokeSigningCredential(
	_ context.Context,
	_ moltnetapi.OptRevokeSigningCredentialReq,
	_ moltnetapi.RevokeSigningCredentialParams,
) (moltnetapi.RevokeSigningCredentialRes, error) {
	h.action = "revoke"
	return signingCommandCredential(), nil
}

func TestSigningRequestCommands(t *testing.T) {
	handler := &stubSigningCommandsHandler{}
	server, credentials := newCLICommandTestServer(t, handler)

	t.Run("create delegated request", func(t *testing.T) {
		var out bytes.Buffer
		err := runSigningRequestCreateCmd(signingRequestCreateOpts{
			apiURL:         server.URL,
			credPath:       credentials,
			message:        "approve release",
			method:         "human-hardware-previewsign",
			teamID:         signingCommandTeamID.String(),
			purpose:        "release approval",
			constraintType: "team-role",
			constraintID:   "manager",
			out:            &out,
		})
		if err != nil {
			t.Fatalf("create signing request: %v", err)
		}
		if handler.createdRequest == nil || !strings.Contains(out.String(), signingCommandRequestID.String()) {
			t.Fatalf("expected created request JSON, got %q", out.String())
		}
	})

	t.Run("create rejects unsupported method", func(t *testing.T) {
		err := runSigningRequestCreateCmd(signingRequestCreateOpts{
			apiURL: server.URL, credPath: credentials, message: "test", method: "unknown",
		})
		if err == nil || !strings.Contains(err.Error(), "unsupported verification method") {
			t.Fatalf("expected unsupported method error, got %v", err)
		}
	})

	t.Run("list signable requests", func(t *testing.T) {
		var out bytes.Buffer
		if err := runSigningRequestListCmd(server.URL, credentials, "signable", &out); err != nil {
			t.Fatalf("list signing requests: %v", err)
		}
		if !handler.requestList.Scope.IsSet() || !strings.Contains(out.String(), signingCommandRequestID.String()) {
			t.Fatalf("expected signable list output, got %q", out.String())
		}
	})

	t.Run("list rejects invalid scope", func(t *testing.T) {
		err := runSigningRequestListCmd(server.URL, credentials, "everything", &bytes.Buffer{})
		if err == nil || !strings.Contains(err.Error(), "invalid --scope") {
			t.Fatalf("expected invalid scope error, got %v", err)
		}
	})

	t.Run("get request", func(t *testing.T) {
		var out bytes.Buffer
		if err := runSigningRequestGetCmd(server.URL, credentials, signingCommandRequestID.String(), &out); err != nil {
			t.Fatalf("get signing request: %v", err)
		}
		if !strings.Contains(out.String(), signingCommandRequestID.String()) {
			t.Fatalf("expected request output, got %q", out.String())
		}
	})

	t.Run("get rejects invalid id", func(t *testing.T) {
		if err := runSigningRequestGetCmd(server.URL, credentials, "bad-id", &bytes.Buffer{}); err == nil {
			t.Fatal("expected invalid request id error")
		}
	})
}

func TestSigningCredentialCommands(t *testing.T) {
	handler := &stubSigningCommandsHandler{}
	server, credentials := newCLICommandTestServer(t, handler)

	t.Run("list credentials", func(t *testing.T) {
		var out bytes.Buffer
		if err := runSigningCredentialListCmd(server.URL, credentials, signingCommandTeamID.String(), &out); err != nil {
			t.Fatalf("list signing credentials: %v", err)
		}
		if handler.credentialList.XMoltnetTeamID != signingCommandTeamID ||
			!strings.Contains(out.String(), signingCommandCredentialID.String()) {
			t.Fatalf("expected credential list output, got %q", out.String())
		}
	})

	t.Run("list rejects invalid team", func(t *testing.T) {
		if err := runSigningCredentialListCmd(server.URL, credentials, "bad-team", &bytes.Buffer{}); err == nil {
			t.Fatal("expected invalid team id error")
		}
	})

	t.Run("get credential", func(t *testing.T) {
		var out bytes.Buffer
		if err := runSigningCredentialGetCmd(
			server.URL,
			credentials,
			signingCommandTeamID.String(),
			signingCommandCredentialID.String(),
			&out,
		); err != nil {
			t.Fatalf("get signing credential: %v", err)
		}
		if !strings.Contains(out.String(), signingCommandCredentialID.String()) {
			t.Fatalf("expected credential output, got %q", out.String())
		}
	})

	t.Run("get rejects invalid credential id", func(t *testing.T) {
		if err := runSigningCredentialGetCmd(
			server.URL,
			credentials,
			signingCommandTeamID.String(),
			"bad-id",
			&bytes.Buffer{},
		); err == nil {
			t.Fatal("expected invalid credential id error")
		}
	})

	for _, action := range []string{"approve", "suspend", "revoke"} {
		t.Run(action, func(t *testing.T) {
			var out bytes.Buffer
			if err := runSigningCredentialActionCmd(
				server.URL,
				credentials,
				signingCommandTeamID.String(),
				signingCommandCredentialID.String(),
				action,
				&out,
			); err != nil {
				t.Fatalf("%s signing credential: %v", action, err)
			}
			if handler.action != action || !strings.Contains(out.String(), signingCommandCredentialID.String()) {
				t.Fatalf("expected %s output, got %q", action, out.String())
			}
		})
	}

	t.Run("action rejects invalid credential id", func(t *testing.T) {
		err := runSigningCredentialActionCmd(
			server.URL,
			credentials,
			signingCommandTeamID.String(),
			"bad-id",
			"approve",
			&bytes.Buffer{},
		)
		if err == nil {
			t.Fatal("expected invalid credential id error")
		}
	})

	t.Run("action rejects unsupported action", func(t *testing.T) {
		err := runSigningCredentialActionCmd(
			server.URL,
			credentials,
			signingCommandTeamID.String(),
			signingCommandCredentialID.String(),
			"delete",
			&bytes.Buffer{},
		)
		if err == nil || !strings.Contains(err.Error(), "unsupported credential action") {
			t.Fatalf("expected unsupported action error, got %v", err)
		}
	})
}
