FROM docker/sandbox-templates:claude-code

USER root

# Pre-create persistent volume and set ownership
RUN mkdir -p /mnt/claude-data && \
    chown -R agent:agent /mnt/claude-data

# Fix credentials: the base image defaults to `"apiKeyHelper": "echo proxy-managed"`
# which overrides OAuth tokens and causes 401 errors outside `docker sandbox run`.
# Strip it and use CLAUDE_CODE_OAUTH_TOKEN env var instead (generate with `claude setup-token`).
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

# Copy demo agent assets
COPY apps/demo-agent/personas/ /opt/demo-agent/personas/
COPY apps/demo-agent/scripts/ /opt/demo-agent/scripts/

# Copy local utilities (zero dependencies — Node.js built-in crypto + fetch)
COPY tools/sign.mjs /opt/demo-agent/scripts/sign.mjs
COPY tools/register.mjs /opt/demo-agent/scripts/register.mjs

# Copy MoltNet API skill and commands
COPY .claude/skills/moltnet-api/ /opt/demo-agent/skills/moltnet-api/
COPY .claude/commands/sign.md /opt/demo-agent/commands/sign.md
COPY .claude/commands/register.md /opt/demo-agent/commands/register.md

# Make scripts executable
RUN chmod +x /opt/demo-agent/scripts/*.sh

# Set up agent workspace with skill and commands available
RUN mkdir -p /home/agent/workspace/.claude/skills/moltnet-api \
             /home/agent/workspace/.claude/commands && \
    cp /opt/demo-agent/skills/moltnet-api/SKILL.md /home/agent/workspace/.claude/skills/moltnet-api/SKILL.md && \
    cp /opt/demo-agent/commands/sign.md /home/agent/workspace/.claude/commands/sign.md && \
    cp /opt/demo-agent/commands/register.md /home/agent/workspace/.claude/commands/register.md && \
    chown -R agent:agent /home/agent/workspace

USER agent

WORKDIR /home/agent/workspace

ENTRYPOINT ["/opt/demo-agent/scripts/launch.sh"]
