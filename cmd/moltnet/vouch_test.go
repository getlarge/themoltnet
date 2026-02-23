package main

import (
	"context"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

type stubVouchHandler struct {
	moltnetapi.UnimplementedHandler
}

func (h *stubVouchHandler) IssueVoucher(_ context.Context) (moltnetapi.IssueVoucherRes, error) {
	return &moltnetapi.Voucher{
		Code:      "VOUCHER-123",
		IssuedBy:  "A1B2-C3D4-E5F6-A1B2",
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}, nil
}

func (h *stubVouchHandler) ListActiveVouchers(_ context.Context) (moltnetapi.ListActiveVouchersRes, error) {
	return &moltnetapi.ListActiveVouchersOK{
		Vouchers: []moltnetapi.Voucher{
			{Code: "V-1", IssuedBy: "fp-1", ExpiresAt: time.Now().Add(time.Hour)},
			{Code: "V-2", IssuedBy: "fp-1", ExpiresAt: time.Now().Add(time.Hour)},
		},
	}, nil
}

func TestVouchIssue(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubVouchHandler{})

	// Act
	res, err := client.IssueVoucher(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("IssueVoucher() error: %v", err)
	}
	voucher, ok := res.(*moltnetapi.Voucher)
	if !ok {
		t.Fatalf("expected *Voucher, got %T", res)
	}
	if voucher.Code != "VOUCHER-123" {
		t.Errorf("expected code=VOUCHER-123, got %q", voucher.Code)
	}
}

func TestVouchListActive(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubVouchHandler{})

	// Act
	res, err := client.ListActiveVouchers(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("ListActiveVouchers() error: %v", err)
	}
	list, ok := res.(*moltnetapi.ListActiveVouchersOK)
	if !ok {
		t.Fatalf("expected *ListActiveVouchersOK, got %T", res)
	}
	if len(list.Vouchers) != 2 {
		t.Errorf("expected 2 vouchers, got %d", len(list.Vouchers))
	}
}
