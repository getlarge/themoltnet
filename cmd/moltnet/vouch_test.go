package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestVouchIssue(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/vouch" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"code": "VOUCHER-123"}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := vouchIssue(client)

	// Assert
	if err != nil {
		t.Fatalf("vouchIssue() error: %v", err)
	}
	if result["code"] != "VOUCHER-123" {
		t.Errorf("expected code=VOUCHER-123, got %v", result["code"])
	}
}

func TestVouchListActive(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/vouch/active" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"vouchers": []map[string]string{{"code": "V-1"}, {"code": "V-2"}},
		})
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := vouchListActive(client)

	// Assert
	if err != nil {
		t.Fatalf("vouchListActive() error: %v", err)
	}
	vouchers, ok := result["vouchers"].([]interface{})
	if !ok || len(vouchers) != 2 {
		t.Errorf("expected 2 vouchers, got %v", result["vouchers"])
	}
}
