package main

import (
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// formatPrincipalDisplay renders a `creator` discriminated union (AgentPrincipal
// | HumanPrincipal) as a short, single-line string for human-readable output.
// Pass the result of the resource-specific Get{Agent,Human}Principal helpers
// — exactly one of the two `ok` flags is expected to be true on a well-formed
// response. Unknown shapes degrade to "unknown" rather than panicking.
//
//	agent := pack.Creator.GetAgentPrincipal()
//	human := pack.Creator.GetHumanPrincipal()
//	fmt.Println(formatPrincipalDisplay(agent, agentOK, human, humanOK))
//	// → "agent:A1B2-C3D4-E5F6-G7H8"     (agent path)
//	// → "human:22222222"                (human path, first 8 chars of humanId)
func formatPrincipalDisplay(
	agent moltnetapi.AgentPrincipal, agentOK bool,
	human moltnetapi.HumanPrincipal, humanOK bool,
) string {
	switch {
	case agentOK:
		return fmt.Sprintf("agent:%s", agent.Fingerprint)
	case humanOK:
		id := human.HumanId.String()
		if len(id) > 8 {
			id = id[:8]
		}
		return fmt.Sprintf("human:%s", id)
	default:
		return "unknown"
	}
}
