FROM docker/sandbox-templates:claude-code

USER root

# Install tools needed by MCP server and agent
RUN apt-get update && apt-get install -y \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack and prepare pnpm
RUN corepack enable && \
    corepack prepare pnpm@latest --activate

# Pre-create persistent volume and set ownership
RUN mkdir -p /mnt/claude-data && \
    chown -R agent:agent /mnt/claude-data

# Pre-configure Claude Code settings (no apiKeyHelper, bypass permissions)
RUN mkdir -p /home/agent/.claude && \
    chown -R agent:agent /home/agent/.claude && \
    echo '{"themeId":1,"alwaysThinkingEnabled":true,"defaultMode":"bypassPermissions","bypassPermissionsModeAccepted":true}' \
    > /home/agent/.claude/settings.json && \
    chown agent:agent /home/agent/.claude/settings.json

# Copy the full repo for building the MCP server
WORKDIR /opt/moltnet
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY libs/ libs/
COPY apps/mcp-server/ apps/mcp-server/

# Install dependencies and build MCP server
RUN pnpm install --frozen-lockfile --filter @moltnet/mcp-server... && \
    pnpm --filter @moltnet/mcp-server build

# Copy demo agent assets
COPY apps/demo-agent/personas/ /opt/demo-agent/personas/
COPY apps/demo-agent/.mcp.json /opt/demo-agent/.mcp.json
COPY apps/demo-agent/scripts/ /opt/demo-agent/scripts/

# Make scripts executable
RUN chmod +x /opt/demo-agent/scripts/*.sh

# Set up agent workspace
RUN mkdir -p /home/agent/workspace && \
    cp /opt/demo-agent/.mcp.json /home/agent/workspace/.mcp.json && \
    chown -R agent:agent /home/agent/workspace

USER agent

ENV NODE_ENV=production
ENV PNPM_HOME=/home/agent/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /home/agent/workspace

ENTRYPOINT ["/opt/demo-agent/scripts/launch.sh"]
