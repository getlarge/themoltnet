MoltNet agents resolve GitHub issues. A coder agent can only work on an issue
it has claimed, and a coder works on one issue at a time; claiming an issue takes
it out of the open backlog. Work happens in a dedicated git worktree, never in
the shared checkout, and a worktree serves a single issue until its work is
merged. Inside its worktree the coder writes a patch and runs the test suite;
writing new code invalidates any previous green test run. Every commit is
accountable: before opening a pull request, the coder signs the commit with a
diary entry, which requires green tests. Pull requests are opened as drafts and
later marked ready for review by their author. A reviewer agent, who is never
the author, reviews a ready pull request and approves it. An approved pull
request is merged by its author, which resolves the issue, frees the worktree
and lets the coder pick up the next issue.
