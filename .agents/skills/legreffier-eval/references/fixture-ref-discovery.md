# Fixture.ref discovery for vivo scenarios

Two discovery paths for finding a `fixture.ref` commit. Both converge
at: a validated ref + scenario seed content from diary entries.

## Path A: Diary-first (primary — for knowledge-gap scenarios)

Start from an episodic incident or semantic decision that represents
knowledge the model wouldn't have from training data:

1. Browse diary for seed entries:

   ```bash
   # Incidents where something broke unexpectedly
   $MOLTNET_CLI entry list --diary-id $DIARY_ID \
     --tags incident --limit 20

   # Architectural decisions with non-obvious reasoning
   $MOLTNET_CLI entry list --diary-id $DIARY_ID \
     --tags decision --limit 20
   ```

2. Follow relations from the seed entry to accountable commits:

   ```bash
   # Find procedural entries linked to the seed
   $MOLTNET_CLI relations list --entry-id <seed-entry-id>

   # Search git for the commit that references the procedural entry
   git log --all --grep="MoltNet-Diary: <procedural-entry-id>" \
     --format="%H %s"
   ```

3. Validate the candidate commit as a fixture.ref:

   ```bash
   git rev-parse --verify <candidate-hash>
   git show <candidate-hash>:<path/to/relevant/file> | head -20
   ```

   Verify the code state at that ref exhibits the precondition the
   scenario needs (e.g., a field that doesn't exist yet, a bug that
   hasn't been fixed).

4. Enrich context for the AUTHOR subagent:
   - The seed entry's content → informs `task.md` (symptom, not diagnosis)
   - The entry's root cause / decision rationale → informs `criteria.json`
   - Related entries → background context for the author

## Path B: Git-first (fallback — when you have a specific code state)

1. Search git for a commit matching a condition:

   ```bash
   # Find commits that touched the relevant file
   git log --all --oneline -- <path/to/file> | head -20

   # Check each candidate for the precondition
   git show <hash>:<path> | grep -c "pattern"
   ```

2. Check for diary trailers on the candidate commit:

   ```bash
   git log -1 --format="%(trailers:key=MoltNet-Diary)" <hash>
   ```

   If present, fetch the diary entry for context enrichment (same as
   Path A step 4).

3. Validate the ref (same as Path A step 3).

## Discovery output

Passed to AUTHOR subagent in Step 1:

- `fixture.ref`: validated commit hash
- Seed entry content (if diary-first path)
- Related diary entries (if any)
- Code state summary at the ref (key files, what's present/absent)
