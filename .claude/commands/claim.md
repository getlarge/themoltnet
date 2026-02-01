Claim a task from TASKS.md. The user will specify which task to claim as: $ARGUMENTS

**IMPORTANT**: This command only works on the **host**, not in Docker sandboxes (git operations required).

If you're in a sandbox, tell the user: "I'm running in a sandbox. Please claim the task from the host using `/claim <task-name>`, then I can start work."

**Detecting sandbox environment**: Check if `/home/agent/workspace` exists and `.git` is not a directory — that indicates a sandbox environment.

If you're on the host, do the following:

1. Read `TASKS.md` from the repo root
2. Find the specified task in the "Available" section
3. If the task is not in Available, report an error (it may already be claimed or not exist)
4. Check the task's dependencies — if any are not in the "Completed" section, warn that this task is blocked
5. Move the task from "Available" to "Active" with:
   - Agent: your session identifier or model name
   - Branch: the current git branch name
   - Status: `in-progress`
   - Started: today's date
6. Commit the change: `git add TASKS.md && git commit -m "tasks: claim <task-name>"`
7. Push: `git push origin HEAD`
8. Confirm the claim and summarize what you need to do

If the push fails because another agent claimed the same task:

1. Pull the latest TASKS.md: `git pull --rebase`
2. Check if your task is still available
3. If not, pick a different available task and ask the user
