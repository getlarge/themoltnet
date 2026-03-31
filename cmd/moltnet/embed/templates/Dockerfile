FROM docker/sandbox-templates:claude-code

USER root

RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# Strip apiKeyHelper so CLAUDE_CODE_OAUTH_TOKEN works
# (base image defaults to "apiKeyHelper": "echo proxy-managed" which overrides OAuth)
RUN mkdir -p /home/agent/.claude && \
    if [ -f /home/agent/.claude/settings.json ]; then \
      jq 'del(.apiKeyHelper) + {"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \
        /home/agent/.claude/settings.json > /tmp/settings.json && \
      mv /tmp/settings.json /home/agent/.claude/settings.json; \
    else \
      echo '{"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \
        > /home/agent/.claude/settings.json; \
    fi && \
    echo '{"hasCompletedOnboarding":true}' > /home/agent/.claude.json && \
    chown -R agent:agent /home/agent/.claude /home/agent/.claude.json

# Pre-install judge with dependencies. test.sh runs from /opt/judge
# where node_modules are already present (no network or write access needed).
COPY judge/ /opt/judge/
RUN cd /opt/judge && npm install --ignore-scripts

# Docker Desktop macOS VM fails TLS 1.3 handshakes with Cloudflare edge IPs
# (api.anthropic.com). Force TLS 1.2 max for Node.js (Claude CLI + judge).
ENV NODE_OPTIONS="--tls-max-v1.2"

USER agent

WORKDIR /app
