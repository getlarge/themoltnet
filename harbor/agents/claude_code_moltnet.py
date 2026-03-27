"""
MoltNet Claude Code agent for Harbor evals.

Headless variant — disables interactive gates and passes through auth.
"""

import os
import shlex

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.base import ExecInput
from harbor.environments.base import BaseEnvironment
from harbor.models.trial.paths import EnvironmentPaths


class ClaudeCodeMoltNet(ClaudeCode):
    """Claude Code agent configured for headless MoltNet eval runs."""

    _HEADLESS_PREAMBLE = (
        "[AUTOMATED RUN -- no user is present to interact]\n"
        "- Do NOT call AskUserQuestion. Make decisions autonomously.\n"
        "- If ExitPlanMode does not exit after one attempt, "
        "proceed with implementation without waiting.\n"
    )

    @staticmethod
    def name() -> str:
        return "claude-code-moltnet"

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)

        env_dir = environment.environment_dir
        for item in env_dir.iterdir():
            if item.name in ("Dockerfile", "setup.sh"):
                continue
            target = f"/workspace/{item.name}"
            if item.is_dir():
                await environment.upload_dir(item, target)
            else:
                await environment.upload_file(item, target)

    def create_run_agent_commands(self, instruction: str) -> list[ExecInput]:
        escaped_instruction = shlex.quote(
            self._HEADLESS_PREAMBLE + instruction
        )

        env = {
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            or "",
            "CLAUDE_CODE_OAUTH_TOKEN": os.environ.get(
                "CLAUDE_CODE_OAUTH_TOKEN", ""
            ),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "FORCE_AUTO_BACKGROUND_TASKS": "1",
            "ENABLE_BACKGROUND_TASKS": "1",
        }

        env = {k: v for k, v in env.items() if v}

        if self.model_name:
            env["ANTHROPIC_MODEL"] = self.model_name.split("/")[-1]
        elif "ANTHROPIC_MODEL" in os.environ:
            env["ANTHROPIC_MODEL"] = os.environ["ANTHROPIC_MODEL"]

        max_thinking_tokens = self._max_thinking_tokens
        if max_thinking_tokens is not None:
            env["MAX_THINKING_TOKENS"] = str(max_thinking_tokens)
        elif "MAX_THINKING_TOKENS" in os.environ:
            env["MAX_THINKING_TOKENS"] = os.environ["MAX_THINKING_TOKENS"]

        env["CLAUDE_CONFIG_DIR"] = (
            EnvironmentPaths.agent_dir / "sessions"
        ).as_posix()

        return [
            ExecInput(
                command=(
                    "mkdir -p $CLAUDE_CONFIG_DIR/debug "
                    "$CLAUDE_CONFIG_DIR/projects/-app "
                    "$CLAUDE_CONFIG_DIR/shell-snapshots "
                    "$CLAUDE_CONFIG_DIR/statsig "
                    "$CLAUDE_CONFIG_DIR/todos"
                ),
                env=env,
            ),
            ExecInput(
                command=(
                    f"claude --verbose --output-format stream-json "
                    f"-p {escaped_instruction} "
                    f"--allowedTools "
                    f"{' '.join(self.ALLOWED_TOOLS)} "
                    f"2>&1 </dev/null | tee /logs/agent/claude-code.txt"
                ),
                env=env,
            ),
        ]
