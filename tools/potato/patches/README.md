# Potato upstream patches

## Solo edge-case persistence patch

`solo-edge-case-persistence.patch` targets Potato upstream commit
`d8fb30605f0533b4f2c8ae858be31a3fe6867381` (the 2.13.0 pilot baseline).
It retains generated edge cases, their human labels and notes, synthesis rounds,
timestamps and the ID counter in the existing atomic Solo state file. Each
submitted label saves immediately. The Solo admin JSON export includes the
same snapshot under `edge_case_synthesis`.

An empty or malformed synthesis response stays in the synthesis phase and
shows a retry action. It no longer appears to be completed annotation.
Existing state files without synthesis data remain readable.

Apply to a dedicated checkout at the pinned revision, using an absolute path
to the patch:

```bash
git apply --check /path/to/tools/potato/patches/solo-edge-case-persistence.patch
git apply /path/to/tools/potato/patches/solo-edge-case-persistence.patch
python -m pytest tests/unit/test_solo_mode -q
```

Install that patched checkout in an isolated Python environment, or build the
runtime from it. Applying the patch does not modify an already running Python
process. Do not restart an older active Solo session expecting this patch to
recover its in-memory cases: the old version neither persisted nor exported
those cases. Preserve the old process until those results can be recovered or
explicitly retired.

### Verification

The patched upstream Solo suite passed **886 tests**, including six new
regression tests for partial saves, generation persistence, final-label export,
legacy state loading, invalid submissions and empty generation.

A separate synthetic browser test exercised the actual Solo blueprint and
HTML templates with a deterministic model stub: generate two cases, submit a
label and note through the browser, terminate the server process, restart from
the same state directory, and verify the remaining case and admin export.
This verifies the persistence path without relying on a model's output quality.

The patch uses Potato's existing atomic state writer. It does not add a journal
or change its disk-error handling. Back up the complete task directory and use
one server worker per task, as required by Potato's production deployment guide.

The patch has not been submitted upstream. Remove it once an upstream release
includes the fix and passes the restart regression.
