# Contributing to MoltNet

MoltNet is building accountable authority for autonomous agents. Contributions
that make the project easier to adopt, safer to run, or clearer to understand
are all valuable.

## Find your path

- **Trying MoltNet or evaluating it at work?** Share what you are building or
  ask a question in [GitHub Discussions](https://github.com/getlarge/themoltnet/discussions).
- **Found a problem?** Use the bug-report form.
- **Have a use case, integration, or product idea?** Use the feature or
  integration request form. The useful detail is the job you are trying to do,
  not a fully designed solution.
- **Ready to make a first code or docs contribution?** Look for
  [`good first issue`](https://github.com/getlarge/themoltnet/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/getlarge/themoltnet/labels/help%20wanted).
- **Want to propose work for an autonomous agent?** Use the Agent Task issue
  form, which asks for the acceptance criteria and context an agent needs.

Please report security vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Before you start

Read the [manifesto](docs/understand/manifesto.md) to understand MoltNet's
principles, then follow [AGENTS.md](AGENTS.md) for the development environment,
architecture, and project commands. The canonical product setup flow is in the
[documentation](https://docs.themolt.net/start/getting-started).

For a focused first change:

1. Fork the repository and create a branch from `origin/main`.
2. Make one coherent, reviewable change.
3. Run the affected project through Nx, for example:

   ```bash
   pnpm exec nx run <project>:test
   pnpm exec nx run <project>:lint
   pnpm exec nx run <project>:typecheck
   ```

4. Open a draft pull request (`gh pr create --draft`) using the template.
   Explain the user problem, the approach, and how you verified it. CI does
   not run on drafts; mark the PR ready for review when it should be
   validated. For stacked PRs, mark only the bottom layer (and optionally the
   tip) ready; keep the others in draft until the layer below them merges.

The repository uses pnpm workspaces and Nx. Prefer Nx targets for build, test,
lint, typecheck, and serve tasks; `AGENTS.md` documents the exceptions.

## Visual evidence for UI changes

Before marking a UI-affecting PR ready for review, include visual evidence in
its description. This applies to browser and Desktop interfaces, shared design
system components, documentation layouts or interactive examples, and changes
elsewhere that alter what users see or how they interact with a surface.

- **Screenshots:** show the changed layout, copy, or visible state. Include
  before and after captures when they help reviewers compare existing and
  updated behavior; for a new surface, show the resulting interface.
- **Recordings:** add a short recording when timing, motion, navigation, focus,
  or a sequence of actions is necessary to understand the change. A recording
  can replace static captures when it also makes the changed states readable.
- **Coverage:** capture the states affected by the change, such as success,
  error, loading, or empty states, at relevant supported window sizes or on
  relevant devices. Include both themes when the change affects their
  appearance. Keep the evidence proportional to the change; do not capture
  unrelated states or pages.

Capture the implemented result, inspect it yourself, and label each image or
clip with the scenario and relevant theme or window size. Refresh evidence
after later commits change the visible result. Use synthetic or redacted data;
never publish secrets, private account data, or unrelated windows.

Embed uploads or durable, reviewer-accessible links in the PR description.
Local file paths and expiring CI artifacts are not sufficient. Commit media
only when it also belongs in documentation or reusable fixtures; PR uploads
are sufficient for review evidence alone.

Tests complement visual evidence. If a UI-affecting change has no capturable
visible effect, explain why in the PR's Visual evidence section and identify
the relevant verification, such as keyboard or accessibility tests. Inability
to run or capture the UI is a validation gap, not an automatic exemption:
describe the blocker and propose alternative evidence, such as reproducible
steps and relevant automated verification. Keep the PR in draft until a reviewer
agrees that the alternative demonstrates the changed behavior. Reviewers should
request changes when evidence is missing, outdated, or does not demonstrate the
affected behavior.

Adaptive review uses the criteria in [REVIEW.md](REVIEW.md#ui-visual-evidence)
for its conventions lane. It reports missing or unassessable evidence as a
coverage gap. An automated review does not replace the author's visual
inspection.

## What makes a good contribution

Start from a concrete user or operator need. Keep changes small enough to
review, preserve agent sovereignty and least authority, and add or update tests
when behavior changes. If a decision changes trust, identity, authorization, or
runtime boundaries, explain the trade-off in the pull request.

The [agent security guide](docs/understand/agent-security.md) and
[mission-integrity model](docs/understand/mission-integrity.md) are especially
relevant for work that affects authority or autonomy.

## Help sustain the work

MoltNet is open source. [Sponsor the project](https://github.com/sponsors/getlarge)
to fund maintainer time, integration hardening, and paid contributor work.
