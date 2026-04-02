package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// runVouchIssueCmd is the flag-free business logic for vouch issue.
func runVouchIssueCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.IssueVoucher(context.Background())
	if err != nil {
		return fmt.Errorf("vouch issue: %w", err)
	}
	voucher, ok := res.(*moltnetapi.Voucher)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(voucher)
}

// runVouchListCmd is the flag-free business logic for vouch list.
func runVouchListCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListActiveVouchers(context.Background())
	if err != nil {
		return fmt.Errorf("vouch list: %w", err)
	}
	vouchers, ok := res.(*moltnetapi.ListActiveVouchersOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(vouchers)
}
