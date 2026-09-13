---
name: product-demo-recording
description: Plan, capture, edit, and visually QA short product demo recordings for docs, releases, and integration walkthroughs. Use when recording or replacing browser/app videos such as n8n or Node-RED flows; not for general-purpose video production.
---

# Product Demo Recording

Treat framing, privacy, narrative, and decoded output as separate release gates.
A successful product run does not prove that the recording is safe, readable,
or cleanly composed.

For native macOS or browser capture mechanics, read
[references/capture-macos.md](references/capture-macos.md).
For browser workflow builders with polling or retry loops, read
[references/browser-workflows.md](references/browser-workflows.md).
For title cards, lower-thirds, diagrams, callouts, and end cards, read
[references/infographic-style.md](references/infographic-style.md).

## Establish the delivery frame first

Before recording:

1. Establish a visual reference:
   - If a previous recording exists, inspect it from start to finish. Extract a
     contact sheet when useful, and note its pacing, framing, annotations, and
     strongest explanatory moments.
   - If there is no previous recording, use the
     `@themoltnet/design-system` library, neighboring docs media, and the
     integrated product's native UI—in that order—to create a title-card still,
     the densest annotated UI still, and an end-card still before recording.
     These approved stills become the baseline for later videos in the series.
2. Read the page where the video will appear. Write a short shot list that
   names the user outcome, required setup, main interaction, waiting or retry
   behavior, and successful result.
3. Choose the final aspect ratio and resolution before arranging the app.
   Prefer a conventional 16:9 frame such as 1440x810 or 1920x1080.
4. Arrange the application so the complete intended content area fits that
   frame. Hide optional sidebars inside the app when needed; do not remove half
   of a sidebar or control with an arbitrary post-production crop.
5. Decide whether browser chrome is part of the composition. Prefer a clean
   browser viewport capture. If that is unavailable, keep the complete browser
   window or place it inside a deliberate frame. A complete window is cleaner
   than clipped tabs, edges, or application content.
6. Review the three representative style frames at their actual display size.
   Do not record the full walkthrough while the overlay system, safe areas, or
   information hierarchy are still being invented.

## Use a safe capture boundary

- Capture one application window or one browser viewport, never a desktop
  rectangle that another application can enter.
- Resolve and lock the exact window identifier before recording. Recheck it
  after navigation, pop-outs, or application restarts.
- Disable notifications and use dedicated demo data, but do not rely on those
  precautions as the privacy boundary.
- Keep credentials, tokens, personal identifiers, private URLs, and unrelated
  account data outside the captured surface. Password masking is necessary but
  does not make credential-entry footage desirable.
- Make the pointer intentional. Park it away from text while a static result is
  being read.

## Record for comprehension

- Use one idea per shot. Hold important configuration and results long enough
  to read at normal playback speed.
- Show setup only when it helps the viewer reproduce the outcome. For
  integration demos, this often means install, authenticate without revealing
  the secret, import the workflow, run it, and inspect the terminal result.
- Prefer native application zoom and layout changes over enlarging a cropped
  raster later.
- Capture the real successful execution. Reconstructed title cards and
  annotations may explain it, but must not imply an action or result that was not
  observed.
- Complete credential creation and connection testing outside the recorded
  take. Begin the narrative from a safe authenticated state, unless credential
  setup itself is the documented subject.
- Record short, independently usable takes when the flow has stable stages.
  This limits re-recording and makes privacy review more precise.
- For a long polling or retry loop, preserve the real ordered states but
  accelerate or trim the repeated idle portion. Hold the initial action,
  terminal workflow state, and accepted result at readable speed.

## Edit without hiding the product

- Preserve every intended application edge. Scale down and pad to the delivery
  frame rather than cropping content to force an aspect ratio.
- Use title and end cards only when they improve orientation or next steps.
- Keep lower-thirds inside a preplanned safe area. They must not cover controls,
  status, output, errors, or identifiers needed to understand the flow.
- Match the established docs visual language when replacing an existing video.
  Do not make a replacement feel less deliberate than the asset it supersedes.
- For broad browser compatibility, default to H.264 High, `yuv420p`, constant
  30 fps, no audio unless narration is intentional, and MP4 fast-start.
- On this macOS toolchain, prefer single-threaded libx264 for the final render
  when practical. Use the bundled helper instead of fast input seeking when
  extracting exact-timestamp QA frames.
- If a frame appears corrupt in an artifact preview, reopen the checksum-stable
  artifact and inspect the video in a native player. The preview path has
  intermittently rendered identical image bytes differently; do not alter a
  video unless the defect is reproducible independently.
- If a frame remains corrupt in normal playback and repeated extraction,
  replace the affected segment from a clean source and re-encode the final
  master with `-threads 1`.

## Review the decoded deliverable

Run the bundled helper against the final file, not an intermediate:

```bash
.agents/skills/product-demo-recording/scripts/qa-video.sh \
  path/to/final.mp4 /private/tmp/demo-video-qa --interval 2 4 5 6
```

The helper writes stream metadata, a sequentially decoded contact sheet, and
start/middle/end plus requested timestamp frames as JPEGs. Use a fresh output
directory.

Then perform all of these checks:

1. Watch the entire final video at normal speed.
2. Inspect the contact sheet for every change of application, modal, shot,
   annotation, and result state.
3. Inspect exact frames immediately before, at, and after every edit boundary.
   Always add timestamps named in review feedback; do not infer that adjacent
   frames are representative.
4. Confirm there are no other apps, desktop areas, notifications, credentials,
   private data, clipped edges, partial browser chrome, odd black borders, or
   obstructed controls.
5. Confirm text is readable, pointer placement is calm, transitions are clean,
   and the visible outcome matches the surrounding documentation.
6. Verify the codec, pixel format, dimensions, frame rate, duration, audio
   choice, and fast-start requirement against the delivery spec.

Do not describe the recording as reviewed until these checks were performed on
the exact file that will be committed.

## Ship and retain deliberately

- Stage only the final asset and intentional documentation changes. Do not add
  raw takes, credentials, browser profiles, or QA exports.
- Keep raw takes until the final file is reviewed and safely committed or
  uploaded. Then follow the operator's retention choice; remove sensitive
  temporary captures explicitly rather than with broad deletion patterns.
- In the handoff, state what was shown, the final technical properties, which
  timestamps were inspected, and where the final asset lives.
