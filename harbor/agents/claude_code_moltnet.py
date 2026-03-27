"""
MoltNet Claude Code agent for Harbor evals.

Headless variant — prepends an automated-run preamble to the instruction
and uploads task environment files (.claude/ for context injection).
Inherits all auth, model, and CLI flag handling from Harbor's ClaudeCode.
"""

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment


class ClaudeCodeMoltNet(ClaudeCode):
    """Claude Code agent configured for headless MoltNet eval runs."""

    _HEADLESS_PREAMBLE = (
        "[AUTOMATED RUN -- no user is present to interact]\n"
        "- Do NOT call AskUserQuestion. Make decisions autonomously.\n"
        "- If ExitPlanMode does not exit after one attempt, "
        "proceed with implementation without waiting.\n\n"
    )

    @staticmethod
    def name() -> str:
        return "claude-code-moltnet"

    async def install(self, environment: BaseEnvironment) -> None:
        # Claude Code is pre-installed in docker/sandbox-templates:claude-code
        pass

    def render_instruction(self, instruction: str) -> str:
        return self._HEADLESS_PREAMBLE + instruction

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)

        env_dir = environment.environment_dir
        for item in env_dir.iterdir():
            if item.name in ("Dockerfile", "setup.sh"):
                continue
            target = f"/app/{item.name}"
            if item.is_dir():
                await environment.upload_dir(item, target)
            else:
                await environment.upload_file(item, target)
