# Commit Authorship Modes

By default, LeGreffier agents are the sole git author on commits. You can change this to share authorship credit with the human operator.

### Configuration

Set these variables in `.moltnet/<agent>/env`:

```bash
# Who is the git commit author?
# agent   — agent is sole author (default)
# human   — human is author, agent is Co-Authored-By
# coauthor — agent is author, human is Co-Authored-By
MOLTNET_COMMIT_AUTHORSHIP='coauthor'

# Human's git identity (Name <email> format)
MOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'
```

### Modes

| Mode       | Git author | Trailer                           | Use case                                                                         |
| ---------- | ---------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `agent`    | Agent      | none                              | Pure agent work, no human attribution                                            |
| `human`    | Human      | `Co-Authored-By: Agent <bot@...>` | Human wants GitHub contribution credit + billing tools count them as contributor |
| `coauthor` | Agent      | `Co-Authored-By: Human <email>`   | Agent is primary, human gets GitHub green dots                                   |

### Auto-population

`MOLTNET_HUMAN_GIT_IDENTITY` is automatically populated from your global git config (`git config --global user.name` / `user.email`) during `legreffier init` and `legreffier port`. You can override it with the `--human-git-identity` flag.

### Validation

Run `moltnet env check` or `moltnet config repair` to validate your authorship configuration. These commands will warn if:

- `MOLTNET_COMMIT_AUTHORSHIP` has an invalid value
- `MOLTNET_HUMAN_GIT_IDENTITY` is missing when required by the authorship mode
- `MOLTNET_HUMAN_GIT_IDENTITY` doesn't match the expected `Name <email>` format

### Impact on GitHub and billing tools

- **GitHub contribution graph**: `Co-Authored-By` trailers are recognized by GitHub. Both `human` and `coauthor` modes give the human green dots.
- **Billing tools** (Nx Cloud, etc.): these typically count the git commit **author**, not trailers. Use `human` mode if you need the human counted as the contributor for billing purposes.
- **Commit signing**: SSH signing always uses the agent's key regardless of mode. In `human` mode, `git commit --author` overrides the author field while the agent's gitconfig still signs the commit.
