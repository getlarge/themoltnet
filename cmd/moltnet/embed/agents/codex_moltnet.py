"""
MoltNet Codex agent for Harbor evals.

Headless variant — prepends an automated-run preamble to the instruction
and uploads task environment files (AGENTS.md for context injection).
Can bridge a host auth cache into Docker when explicitly enabled and Codex
CLI credentials are stored in a file-backed CODEX_HOME.
"""

import logging
import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import with_prompt_template
from harbor.agents.installed.codex import Codex
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths

from .headless_prompt import build_headless_instruction

logger = logging.getLogger(__name__)


class CodexMoltNet(Codex):
    """Codex agent configured for headless MoltNet eval runs."""

    _SHARED_CODEX_HOME = "/home/agent/.codex"

    @staticmethod
    def name() -> str:
        return "codex-moltnet"

    async def install(self, environment: BaseEnvironment) -> None:
        # Codex CLI is pre-installed in the eval Docker image
        pass

    def render_instruction(self, instruction: str) -> str:
        return build_headless_instruction(instruction)

    def _host_auth_cache_path(self) -> Path:
        configured = os.environ.get("MOLTNET_CODEX_AUTH_CACHE_PATH")
        if configured:
            return Path(configured).expanduser()

        codex_home = os.environ.get("CODEX_HOME", "~/.codex")
        return Path(codex_home).expanduser() / "auth.json"

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)

        if os.environ.get("MOLTNET_ENABLE_CODEX_AUTH_CACHE") == "1":
            auth_cache = self._host_auth_cache_path()
            if auth_cache.is_file():
                await environment.upload_file(
                    auth_cache,
                    f"{self._SHARED_CODEX_HOME}/auth.json",
                )
            else:
                logger.info(
                    "Codex auth cache bridging enabled but no auth.json found at %s",
                    auth_cache,
                )

        env_dir = environment.environment_dir
        for item in env_dir.iterdir():
            if item.name in ("Dockerfile", "setup.sh"):
                continue
            target = f"/app/{item.name}"
            if item.is_dir():
                await environment.upload_dir(item, target)
            else:
                await environment.upload_file(item, target)

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        if not self.model_name:
            raise ValueError("Model name is required")

        model = self.model_name.split("/")[-1]
        env = {
            "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", ""),
            "CODEX_HOME": self._SHARED_CODEX_HOME,
        }

        if openai_base_url := os.environ.get("OPENAI_BASE_URL"):
            env["OPENAI_BASE_URL"] = openai_base_url

        cli_flags = self.build_cli_flags()
        reasoning_flag = (cli_flags + " ") if cli_flags else ""

        setup_command = """
mkdir -p "$CODEX_HOME" /tmp/codex-secrets
if [ -n "${OPENAI_API_KEY}" ]; then
  cat > /tmp/codex-secrets/auth.json <<EOF
{
  "OPENAI_API_KEY": "${OPENAI_API_KEY}"
}
EOF
  ln -sf /tmp/codex-secrets/auth.json "$CODEX_HOME/auth.json"
fi
                """

        skills_command = self._build_register_skills_command()
        if skills_command:
            setup_command += f"\n{skills_command}"

        mcp_command = self._build_register_mcp_servers_command()
        if mcp_command:
            setup_command += f"\n{mcp_command}"

        await self.exec_as_agent(
            environment,
            command=setup_command,
            env=env,
        )
        try:
            await self.exec_as_agent(
                environment,
                command=(
                    "if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; "
                    "codex exec "
                    "--dangerously-bypass-approvals-and-sandbox "
                    "--skip-git-repo-check "
                    f"--model {model} "
                    "--json "
                    "--enable unified_exec "
                    f"{reasoning_flag}"
                    "-- "
                    f"{escaped_instruction} "
                    f"2>&1 </dev/null | tee {EnvironmentPaths.agent_dir / self._OUTPUT_FILENAME}"
                ),
                env=env,
            )
        finally:
            try:
                await self.exec_as_agent(
                    environment,
                    command='rm -rf /tmp/codex-secrets && if [ -n "${OPENAI_API_KEY}" ]; then rm -f "$CODEX_HOME/auth.json"; fi',
                    env=env,
                )
            except Exception:
                pass
