# Writing a process description

The PDDL designer turns two short texts into a planning model. The model reads
them literally. Anything a colleague would assume without being told has to be
written down, or the model will leave it out. Each rule below comes from a live
run where leaving that thing unsaid produced a wrong model.

## Two texts

- **Process description**: the general rules of the process. Who acts, what
  each step needs, and what it changes. It becomes the planning domain.
- **Situation**: one concrete case. Which agents and items exist, what is true
  at the start, and the goal. It becomes the planning problem.

Keep them separate. The process description never names specific items
(`issue-101`), and the situation never restates the rules.

## Process description checklist

**1. Say who does each step.** Name the kind of agent, or say that trusted code
does it and no agent is needed.

> "Trusted code retrieves the documents" was modeled as a retrieval agent that
> the situation never mentioned, so retrieval could never run.

**2. For every step, say what it needs, what it produces, what it uses up, and
what becomes free again.** One sentence per step works well:

> "To _step_, _who_ needs _conditions_. Afterwards _what is now true_; _what is
> used up or no longer true_; _who or what is free again_."

**3. Say what stops being true.** A model only removes a fact when the text
says so. This is the most common gap.

> "The reviewer approves the pull request" left the reviewer busy for good, so a
> single reviewer could approve only one pull request. "The reviewer is free
> again afterwards" fixed it.

**4. Things a step produces come from prepared slots.** A planning model cannot
create new things. If a step produces a commit, a report or a label, say that
they come from a fixed set of slots, that a slot is either available or used,
and that using one makes it used for good.

> Without this, one commit and one pull request were reused to resolve two
> issues.

**5. Say whose things are whose.** When a step uses an item that belongs to
someone, say so: "the coder runs the tests in **its own** worktree", "the commit
**belongs to that issue**".

> "The coder runs the tests" let any busy coder run tests in another coder's
> worktree.

**6. A step that marks work as done must require the work.** Write "the docs
check is complete once the added passage has been reviewed", not "then the docs
check is complete".

> The model let the docs check be marked complete before anything was
> reviewed.

**7. Say what resets.** If finishing an item makes earlier results stale, say
so: "after the merge the worktree holds no patch and no passing tests".

> Passing tests left over in a worktree let the next issue be committed without
> writing any code.

**8. Joins must have a fixed number of branches.** "When coverage and the docs
check are both done" works. "When every change group has a report" does not:
the model cannot express "every" over a number of items that varies. Give a
fixed count, or make each item's chain end in its own result.

**9. State conditions as facts.** "If the pull request adds documentation text"
works when the situation then says whether it does. Avoid conditions that depend
on judgment ("if the change is important").

**10. Leave out what does not affect the order of steps.** Budgets, timeouts,
tool names and output formats do not belong here, and vague verbs ("handles",
"takes care of") hide what actually changes.

## Situation checklist

- **List every agent and say each one is free.** An agent the domain needs but
  the situation never marks free can never act.
- **Give each pool a size and say every slot is available.** "Two commit slots
  and two pull-request slots are available." Size each pool for the goal: two
  issues need two of each.
- **State the facts the conditions depend on.** "pr-42 changed source code and
  adds documentation text."
- **State the goal as facts that can be checked.** "Both issues are resolved",
  not "the work is done".

## Reading the result

| Status         | Meaning                                                                                                                                                                       | What to do                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `planned`      | A plan exists                                                                                                                                                                 | Read the plan for shortcuts: a step that skips work, an item used twice, someone acting on another person's things. Each one is a missing rule. |
| `unsolvable`   | No plan exists. If `reachability` lists blocked actions, the facts they lack are the cause: usually something the situation never states or a step that never frees something | Add the missing fact to the situation, or the missing "free again" or "produces" rule to the description                                        |
| `search_limit` | The checker gave up before deciding                                                                                                                                           | Run the rendered PDDL through Fast Downward                                                                                                     |
| `invalid`      | A stage still failed its checks after correction                                                                                                                              | Read that stage's `issues`; the description is often ambiguous at that point                                                                    |

Hints in `issues` are not errors. "No precondition links ?c and ?w" is fine
when any agent may act on any item (any arm may move any block), and a bug when
only the owner may (rule 5).

## Example

Before. Retrieval had no agent, the docs check could be completed without
reviewing anything, and the situation did not make the passages exist:

> "Next, trusted code retrieves the documents relevant to the pull request. …
> When the pull request adds documentation text, a docs-check agent also reviews
> each added passage; otherwise the docs check is not needed."

After:

> "Retrieval is done by trusted code and needs no agent: once the contract
> changes are extracted, or for a docs-only pull request, the relevant documents
> are retrieved. … A free docs-check agent reviews the added passage of the pull
> request; the passage is then reviewed, and the agent is free again. The docs
> check is complete once the pull request's added passage has been reviewed."

With the situation: "pr-42 adds one documentation passage, passage-1."
