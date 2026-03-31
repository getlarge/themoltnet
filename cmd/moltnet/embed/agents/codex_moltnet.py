"""
MoltNet Codex agent for Harbor evals.

Headless variant — prepends an automated-run preamble to the instruction
and uploads task environment files (AGENTS.md for context injection).
Inherits all auth, model, and CLI flag handling from Harbor's Codex.
"""

import logging

from harbor.agents.installed.codex import Codex
from harbor.environments.base import BaseEnvironment

from .headless_prompt import build_headless_instruction

logger = logging.getLogger(__name__)


class CodexMoltNet(Codex):
    """Codex agent configured for headless MoltNet eval runs."""

    @staticmethod
    def name() -> str:
        return "codex-moltnet"

    async def install(self, environment: BaseEnvironment) -> None:
        # Codex CLI is pre-installed in the eval Docker image
        pass

    def render_instruction(self, instruction: str) -> str:
        return build_headless_instruction(instruction)

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
