// Regression test for issue #992 — `moltnet rendered-pack judge` crashed
// with `decode field "creator": decode AgentIdentity: "{" expected: unexpected
// byte 110 'n' at 2450` because the previous Go SDK generated a non-nullable
// AgentIdentity for ContextPackResponse.Creator. After moving the REST DTO to
// a discriminated union (PrincipalIdentity = AgentPrincipal | HumanPrincipal),
// ogen now produces a sum type that decodes both variants.

package moltnetapi_test

import (
	"testing"

	"github.com/go-faster/jx"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func TestContextPackResponseDecodesAgentCreator(t *testing.T) {
	payload := []byte(`{
    "id": "00000000-0000-0000-0000-000000000001",
    "diaryId": "00000000-0000-0000-0000-000000000002",
    "packCid": "bafy-test",
    "packCodec": "dag-cbor",
    "packType": "compile",
    "params": {},
    "payload": {},
    "creator": {
      "kind": "agent",
      "identityId": "00000000-0000-0000-0000-000000000003",
      "fingerprint": "A1B2-C3D4-E5F6-1234",
      "publicKey": "ed25519:somebase64payload"
    },
    "supersedesPackId": null,
    "pinned": false,
    "expiresAt": "2026-12-31T00:00:00Z",
    "createdAt": "2026-05-03T17:00:00Z"
  }`)

	var resp moltnetapi.ContextPackResponse
	if err := resp.Decode(jx.DecodeBytes(payload)); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !resp.Creator.IsAgentPrincipal() {
		t.Fatalf("expected agent creator, got %v", resp.Creator.Type)
	}
}

func TestContextPackResponseDecodesHumanCreator(t *testing.T) {
	payload := []byte(`{
    "id": "00000000-0000-0000-0000-000000000001",
    "diaryId": "00000000-0000-0000-0000-000000000002",
    "packCid": "bafy-test-human",
    "packCodec": "dag-cbor",
    "packType": "compile",
    "params": {},
    "payload": {},
    "creator": {
      "kind": "human",
      "humanId": "00000000-0000-0000-0000-000000000003",
      "identityId": null
    },
    "supersedesPackId": null,
    "pinned": false,
    "expiresAt": "2026-12-31T00:00:00Z",
    "createdAt": "2026-05-03T17:00:00Z"
  }`)

	var resp moltnetapi.ContextPackResponse
	if err := resp.Decode(jx.DecodeBytes(payload)); err != nil {
		t.Fatalf("decode failed (issue #992 regression): %v", err)
	}
	if !resp.Creator.IsHumanPrincipal() {
		t.Fatalf("expected human creator, got %v", resp.Creator.Type)
	}
}
