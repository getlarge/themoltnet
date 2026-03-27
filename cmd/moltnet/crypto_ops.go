package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

// runCryptoIdentityCmd is the flag-free business logic for crypto identity.
func runCryptoIdentityCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetCryptoIdentity(context.Background())
	if err != nil {
		return fmt.Errorf("crypto identity: %w", err)
	}
	identity, ok := res.(*moltnetapi.CryptoIdentity)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(identity)
}

// runCryptoVerifyCmd is the flag-free business logic for crypto verify.
func runCryptoVerifyCmd(apiURL, credPath, signature string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.VerifyCryptoSignature(context.Background(), &moltnetapi.VerifyCryptoSignatureReq{
		Signature: signature,
	})
	if err != nil {
		return fmt.Errorf("crypto verify: %w", err)
	}
	result, ok := res.(*moltnetapi.CryptoVerifyResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}
	return printJSON(result)
}

