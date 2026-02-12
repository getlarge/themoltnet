package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDoRegister_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected content type: %s", r.Header.Get("Content-Type"))
		}

		body, _ := io.ReadAll(r.Body)
		var req RegisterRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("unmarshal request: %v", err)
		}
		if req.VoucherCode != "test-voucher" {
			t.Errorf("unexpected voucher: %s", req.VoucherCode)
		}
		if len(req.PublicKey) < 10 {
			t.Errorf("public key too short: %s", req.PublicKey)
		}

		resp := RegisterResponse{
			IdentityID:   "uuid-123",
			Fingerprint:  "ABCD-1234-EF56-7890",
			PublicKey:    req.PublicKey,
			ClientID:     "client-id",
			ClientSecret: "client-secret",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	result, err := DoRegister(server.URL, "test-voucher")
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	if result.Response.IdentityID != "uuid-123" {
		t.Errorf("identity: got %s, want uuid-123", result.Response.IdentityID)
	}
	if result.Response.ClientID != "client-id" {
		t.Errorf("clientId: got %s, want client-id", result.Response.ClientID)
	}
	if result.KeyPair == nil {
		t.Fatal("keypair is nil")
	}
}

func TestDoRegister_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(ProblemDetails{
			Type:   "urn:moltnet:problem:voucher-invalid",
			Title:  "Invalid voucher",
			Status: 403,
			Detail: "Already redeemed",
		})
	}))
	defer server.Close()

	_, err := DoRegister(server.URL, "bad-voucher")
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got == "" {
		t.Error("error message is empty")
	}
}

func TestDoRegister_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer server.Close()

	_, err := DoRegister(server.URL, "voucher")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDoRegister_NetworkFailure(t *testing.T) {
	_, err := DoRegister("http://127.0.0.1:1", "voucher")
	if err == nil {
		t.Fatal("expected error")
	}
}
