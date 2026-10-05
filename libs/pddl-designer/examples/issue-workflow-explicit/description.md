MoltNet agents resolve GitHub issues. Each issue starts open. An idle coder agent
can claim one open issue; the issue is then claimed by that coder and no longer
open, and the coder stays busy until that issue is merged. The coder takes one
free worktree for its claimed issue; the worktree then belongs to that issue
until the merge frees it. In its worktree the coder writes a patch for the
issue, then runs the tests. Tests pass only for the patch currently in the
worktree; writing a new patch makes earlier passing tests count for nothing.
Commits, pull requests and diary entries are prepared in advance as numbered
slots: each slot is either available or used, and using one makes it used for
good. To commit, the coder needs passing tests for the current patch, one
available commit slot and one available diary entry; the commit then belongs to
that issue and is signed with that diary entry. The coder opens one available
pull request as a draft for the issue's signed commit, then marks it ready. A
free reviewer agent who is not the pull request's author reviews a ready pull
request and approves it; the reviewer is free again afterwards. The author
merges an approved pull request for its own issue: the issue is resolved, the
worktree is free again and holds no patch and no passing tests, and the coder is
idle again.
