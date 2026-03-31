"""
Shared automated-run prompt fragments for Harbor eval agents.
"""

COMMON_HEADLESS_PREAMBLE = (
    "[AUTOMATED RUN -- no user is present to interact]\n"
    "- Make decisions autonomously.\n"
    "- Do not ask follow-up questions.\n"
)


def build_headless_instruction(instruction: str, *extra_lines: str) -> str:
    parts = [COMMON_HEADLESS_PREAMBLE]
    for line in extra_lines:
        if line:
            parts.append(f"{line}\n")
    parts.append("\n")
    parts.append(instruction)
    return "".join(parts)
