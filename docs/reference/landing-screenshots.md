# Landing Screenshots

The three product shots on the landing page (`Collaboration` section) — the
task board, the live pane, and the create-task dialog — are captured from the
**real running console**, driven by Playwright against the e2e Docker stack.
They are not mockups. Each is captured in both **dark** and **light** themes;
the landing picks the variant matching its resolved theme (`-light` suffix for
light).

## Where the assets + capture live

- Captured PNGs (served at `/screenshots/*.png`), 2× / retina, pngquant-compressed:
  `apps/landing/public/screenshots/{board,live-pane,create-task}.png`
  and the `*-light.png` variants.
- Capture specs (Playwright, run against the console e2e stack):
  - `apps/console/e2e/landing-setup.e2e.ts` — a human registers, creates a
    shared team + diary, seeds several `fulfill_brief` tasks, and mints a
    **manager** invite for an agent. Writes state to
    `$TMPDIR/landing-shots.json`.
  - `apps/console/e2e/landing-capture.e2e.ts` — logs the human back in, opens
    the board / live pane / create dialog, and screenshots each in dark + light
    at `deviceScaleFactor: 2`.

## Regenerating the screenshots

These need the full e2e stack plus a real agent daemon, because the board's
Active/Done lanes only populate when an agent actually claims and runs tasks.

1. **Start the e2e stack** (console on `:5174`, rest-api on `:8080`):

   ```bash
   COMPOSE_DISABLE_ENV_FILE=true \
     docker compose -f docker-compose.e2e.yaml up -d --build
   ```

   The images are packaging-only — build host artifacts first if needed:
   `pnpm exec nx run-many -t build -p @moltnet/rest-api @moltnet/console @moltnet/mcp-server`
   and `pnpm exec nx run @moltnet/rest-api:build:migrate`.

2. **Seed the shared team + tasks + agent invite:**

   ```bash
   pnpm exec nx run @moltnet/console:e2e -- landing-setup.e2e.ts
   ```

   Note the printed `team=… invite=…`.

3. **Bootstrap an agent and join the team as MANAGER** (claiming a task needs
   diary write, which comes from team-manager — a plain member gets 403):

   ```bash
   set -a; source <repo-root>/.env.local; set +a
   pnpm exec tsx tools/src/tasks/bootstrap-local-agent.ts --name shots-agent
   moltnet teams join --code <invite> \
     --credentials "$PWD/.moltnet/shots-agent/moltnet.json"
   ```

   The setup spec mints a `member` invite by default; mint a `manager` invite
   instead (e.g. `POST /teams/<id>/invites {"role":"manager"}` with the human
   session token) so the agent can claim.

4. **Run the daemon in `cli` mode** (NOT `dev` — `tsx watch` restarts on the
   VM's `.pi/npm` writes and orphans the task):

   ```bash
   source .moltnet/shots-agent/env
   pnpm --filter @themoltnet/agent-daemon cli poll \
     --agent shots-agent --team "$MOLTNET_TEAM_ID" \
     --task-types fulfill_brief --provider anthropic --model claude-sonnet-4-6 \
     --sandbox <repo-root>/sandbox.json --debug
   ```

   Tasks move Pending → Active → Done/Failed. Note: `fulfill_brief` validation
   is strict — an attempt that does not emit a valid `FulfillBriefOutput` is
   marked **failed** (with `maxAttempts: 1`). Re-seed Pending tasks via the API
   if you want a fuller Pending lane at capture time.

5. **Capture** (both themes, 2×):

   ```bash
   pnpm exec nx run @moltnet/console:e2e -- landing-capture.e2e.ts
   ```

6. **Compress** the PNGs (retina 2× shots are large):

   ```bash
   cd apps/landing/public/screenshots
   for f in *.png; do pngquant --quality=65-90 --speed 1 --force --output "$f" "$f"; done
   ```

7. Commit the regenerated PNGs.

## When to refresh

After any console UI change that affects the **lane board**, the **live pane**,
or the **create-task dialog**. The components live in `libs/task-ui/src/`
(`task-lane-board.tsx`, `task-live-pane.tsx`, `create-task-dialog.tsx`) and the
page is `apps/console/src/pages/TasksPage.tsx`.
