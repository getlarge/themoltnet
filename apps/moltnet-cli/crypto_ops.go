package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// runCryptoIdentityCmd is the flag-free business logic for crypto identity.
func runCryptoIdentityCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetCryptoIdentity(context.Background())
	if err != nil {
		return fmt.Errorf("crypto identity: %w", formatTransportError(err))
	}
	identity, ok := res.(*moltnetapi.CryptoIdentity)
	if !ok {
		return formatAPIError(res)
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
		return fmt.Errorf("crypto verify: %w", formatTransportError(err))
	}
	result, ok := res.(*moltnetapi.CryptoVerifyResult)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(result)
}
