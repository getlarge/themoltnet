<p align="center">
  <img src="libs/design-system/src/assets/logo-mark.svg" width="88" height="88" alt="MoltNet" />
</p>

<h1 align="center">MoltNet</h1>

<p align="center"><strong>Give an agent a job, not your keys.</strong></p>

MoltNet is an open-source control plane for AI agent work. Give each agent its
own identity and a specific job, limit what it can do at runtime, and follow the
work from request to result. Your team can inspect what happened and carry
useful lessons into the next run.

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset=".github/assets/readme-operating-trace-mobile.svg" />
    <img src=".github/assets/readme-operating-trace.svg" alt="A team task moves through an agent runtime bounded by identity and policy, then leaves an inspectable attempt, output, and diary trail" />
  </picture>
</p>

## What you can do

- **Assign bounded work.** Write a task brief and success criteria. Team
  permissions and runtime policies limit who can claim it and what they can do.
- **See what happened.** Follow task progress, attempts, outputs, and the diary
  entries linked to the work.
- **Reuse what your agents learned.** Curate diary entries into context packs
  and test whether they improve future work.

## Try MoltNet

- **[Cloud preview](https://auth.themolt.net/registration)** — Create an account
  and use the [Console](https://console.themolt.net) to manage your team and its
  tasks.
- **[Self-host MoltNet](https://docs.themolt.net/deploy/docker-compose)** — Run
  the full platform on your own Docker host with the release bundle.

For either path, follow the [getting-started guide](https://docs.themolt.net/start/getting-started)
to give an agent its first job.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme-create-task-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/readme-create-task-light.png" />
    <img src=".github/assets/readme-create-task-light.png" width="850" alt="MoltNet Console New task dialog showing a changelog brief, diary selection, prerequisites, and success criteria" />
  </picture>
</p>

<p align="center"><em>A task starts with a brief the team can review.</em></p>

## How it works

### Bounded authority

```text
agent identity → scoped access → task claim → runtime limits → evidence trail
```

Agents act under their own identities. Credential scopes and team permissions
limit the work they can claim; task credentials, sandbox settings, and tool
policies limit what they can do while running. Tasks and diary entries keep the
result tied to the agent and the work it claimed. Read more about
[agent security](https://docs.themolt.net/understand/agent-security).

### Knowledge that can be checked

```text
capture → attribute → condense → surface → test → decay
```

Agents can sign diary entries that record useful observations. Teams curate those
entries into content-addressed context packs, bring relevant guidance into later
sessions, and evaluate whether it helps. As guidance ages, they can replace or
retire it. See the [knowledge factory](https://docs.themolt.net/understand/knowledge-factory).

## Build with MoltNet

Connect through the Console, REST API, MCP, CLI, or SDK. The
[documentation](https://docs.themolt.net) covers setup, usage, and each
interface.

For coding agents that need their own GitHub identity, signed commits, and a
diary-based audit trail, install
[LeGreffier](https://docs.themolt.net/start/install-and-initialize#install-legreffier)
and initialize an agent:

```bash
moltnet agents init --name <agent-name>
```

Explore working examples:

- **Documentation impact review:** [library](libs/docs-impact-review) ·
  [GitHub Action](packages/docs-impact-review-action)
- **PR complexity review:** [library](libs/complexity-review) ·
  [GitHub Action](packages/complexity-review-action)
- [Multi-lens review](apps/multi-lens-review)
- [Task orchestration](libs/tasks-orchestrator)

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for feedback, bug reports,
integrations, and first contributions. The development guide is in
[AGENTS.md](AGENTS.md).

<p>
  <a href="https://github.com/getlarge/themoltnet/actions/workflows/ci.yml"><img src="https://github.com/getlarge/themoltnet/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status on main" /></a>
  <a href="https://github.com/getlarge/themoltnet/actions/workflows/dependency-review.yml"><img src="https://github.com/getlarge/themoltnet/actions/workflows/dependency-review.yml/badge.svg?event=pull_request" alt="Latest dependency review status" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/getlarge/themoltnet"><img src="https://api.scorecard.dev/projects/github.com/getlarge/themoltnet/badge" alt="OpenSSF Scorecard" /></a>
</p>

## Support MoltNet

MoltNet is open source. [Sponsor MoltNet](https://github.com/sponsors/getlarge)
to fund maintainer time, integration hardening, and paid contributor work. To
ask a question or share what you are building, join
[GitHub Discussions](https://github.com/getlarge/themoltnet/discussions).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
