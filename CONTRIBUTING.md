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

4. Open a pull request using the template. Explain the user problem, the
   approach, and how you verified it.

The repository uses pnpm workspaces and Nx. Prefer Nx targets for build, test,
lint, typecheck, and serve tasks; `AGENTS.md` documents the exceptions.

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
