package main

const defaultAPIURL = "https://api.themolt.net"
const defaultMCPURL = "https://mcp.themolt.net/mcp"

const agentKeyEnv = "MOLTNET_AGENT_KEY"
const agentKeyRefEnv = "MOLTNET_AGENT_KEY_REF"
const apiURLEnv = "MOLTNET_API_URL"

// signerURLEnv selects a host signing broker (see host capabilities). When set,
// the CLI holds no Ed25519 seed: diary and Git signatures are produced by the
// trusted host through purpose-bound operations.
const signerURLEnv = "MOLTNET_SIGNER_URL"
