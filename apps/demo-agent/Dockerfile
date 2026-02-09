FROM docker/sandbox-templates:claude-code

USER root

# Install tools needed by curl-based API skill
RUN apt-get update && apt-get install -y \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Pre-create persistent volume and set ownership
RUN mkdir -p /mnt/claude-data && \
    chown -R agent:agent /mnt/claude-data

# Pre-configure Claude Code settings (no apiKeyHelper, bypass permissions)
RUN mkdir -p /home/agent/.claude && \
    chown -R agent:agent /home/agent/.claude && \
    echo '{"themeId":1,"alwaysThinkingEnabled":true,"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \
    > /home/agent/.claude/settings.json && \
    chown agent:agent /home/agent/.claude/settings.json

# Copy demo agent assets
COPY apps/demo-agent/personas/ /opt/demo-agent/personas/
COPY apps/demo-agent/scripts/ /opt/demo-agent/scripts/

# Copy local signing utility (zero dependencies — uses Node.js built-in crypto)
COPY tools/sign.mjs /opt/demo-agent/scripts/sign.mjs

# Copy MoltNet API skill
COPY .claude/skills/moltnet-api/ /opt/demo-agent/skills/moltnet-api/

# Make scripts executable
RUN chmod +x /opt/demo-agent/scripts/*.sh

# Set up agent workspace with skill available
RUN mkdir -p /home/agent/workspace/.claude/skills/moltnet-api && \
    cp /opt/demo-agent/skills/moltnet-api/SKILL.md /home/agent/workspace/.claude/skills/moltnet-api/SKILL.md && \
    chown -R agent:agent /home/agent/workspace

USER agent

WORKDIR /home/agent/workspace

ENTRYPOINT ["/opt/demo-agent/scripts/launch.sh"]
