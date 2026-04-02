"""
MoltNet Claude Code agent for Harbor evals.

Headless variant — prepends an automated-run preamble to the instruction
and uploads task environment files (.claude/ for context injection).
Inherits all auth, model, and CLI flag handling from Harbor's ClaudeCode.
"""

import asyncio
import logging
from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment

from .headless_prompt import build_headless_instruction

logger = logging.getLogger(__name__)

# Anthropic API connectivity check
_API_HOST = "api.anthropic.com"
_CONNECTIVITY_MAX_ATTEMPTS = 5
_CONNECTIVITY_INITIAL_DELAY_SEC = 2


class ClaudeCodeMoltNet(ClaudeCode):
    """Claude Code agent configured for headless MoltNet eval runs."""

    @staticmethod
    def name() -> str:
        return "claude-code-moltnet"

    async def install(self, environment: BaseEnvironment) -> None:
        # Claude Code is pre-installed in docker/sandbox-templates:claude-code
        pass

    def render_instruction(self, instruction: str) -> str:
        return build_headless_instruction(
            instruction,
            "- Do NOT call AskUserQuestion.",
            "- If ExitPlanMode does not exit after one attempt, "
            "proceed with implementation without waiting.",
        )

    def _get_session_dir(self) -> Path | None:
        """Find the main session dir, ignoring subagent subdirectories.

        The base implementation uses rglob("*.jsonl") which also finds
        subagent JSONL files in <session-id>/subagents/, producing
        multiple parent dirs and bailing out. We filter those out.
        """
        sessions_root = self.logs_dir / "sessions"
        if not sessions_root.exists():
            return None

        project_root = sessions_root / "projects"
        if not project_root.is_dir():
            return None

        candidates = []
        for project_dir in project_root.iterdir():
            if not project_dir.is_dir():
                continue
            # Only look for top-level JSONL files (not in subagent dirs)
            jsonl_files = list(project_dir.glob("*.jsonl"))
            if jsonl_files:
                candidates.append(project_dir)

        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            # Pick most recently modified; log for debuggability
            picked = max(candidates, key=lambda d: d.stat().st_mtime)
            print(
                f"Multiple project dirs with sessions: "
                f"{[d.name for d in candidates]}, using {picked.name}"
            )
            return picked
        return None

    async def _wait_for_api_connectivity(
        self, environment: BaseEnvironment
    ) -> None:
        """Quick sanity check that the container can reach the Anthropic API.

        Uses --tls-max 1.2 to match the NODE_OPTIONS constraint set in the
        Dockerfile (Docker Desktop macOS VM breaks TLS 1.3 with Cloudflare).
        """
        delay = _CONNECTIVITY_INITIAL_DELAY_SEC
        for attempt in range(1, _CONNECTIVITY_MAX_ATTEMPTS + 1):
            result = await environment.exec(
                "curl -sS --tls-max 1.2 --max-time 5 "
                f"-o /dev/null https://{_API_HOST}/",
            )
            if result.return_code == 0:
                logger.info(
                    "API connectivity OK (attempt %d/%d)",
                    attempt,
                    _CONNECTIVITY_MAX_ATTEMPTS,
                )
                return
            # Harbor merges stderr into stdout; -sS errors appear there
            output = (result.stdout or "").strip()
            error_line = output.split("\n")[-1] if output else ""
            logger.warning(
                "API connectivity check failed (attempt %d/%d, rc=%d), "
                "retrying in %.1fs — %s",
                attempt,
                _CONNECTIVITY_MAX_ATTEMPTS,
                result.return_code,
                delay,
                error_line or f"exit {result.return_code}",
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)

        logger.error(
            "API connectivity not established after %d attempts — "
            "proceeding anyway, Claude CLI will retry internally",
            _CONNECTIVITY_MAX_ATTEMPTS,
        )

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

        await self._wait_for_api_connectivity(environment)
