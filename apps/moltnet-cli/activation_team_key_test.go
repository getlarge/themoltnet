package main

import (
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"testing"
)

func TestActivationVerifiesSelectedTeamBinding(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	config := &CredentialsFile{SubjectID: "subject", AgentKeyRefs: map[string]SecretReference{a.String(): {Provider: "file", Key: TeamAgentKeyKey("subject", a.String())}}}
	whoami := &moltnetapi.Whoami{CredentialBinding: moltnetapi.NewOptWhoamiCredentialBinding(moltnetapi.NewProvenanceGraphTeamNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphTeamNode{BoundTeamId: a}))}
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err != nil {
		t.Fatal(err)
	}
	whoami.CredentialBinding.Value.ProvenanceGraphTeamNode.BoundTeamId = b
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err == nil {
		t.Fatal("activation accepted wrong team binding")
	}
	whoami.CredentialBinding = moltnetapi.NewOptWhoamiCredentialBinding(moltnetapi.NewProvenanceGraphIdentityNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphIdentityNode{}))
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err == nil {
		t.Fatal("activation accepted identity grant in team slot")
	}
	config.AgentKeyRefs = nil
	config.AgentKeyRef = &SecretReference{Provider: "file", Key: AgentKeyKey("subject")}
	if err := verifySelectedTeamBinding(config, whoami, a.String()); err != nil {
		t.Fatal("identity fallback was rejected")
	}
}
