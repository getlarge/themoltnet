# Desktop Screenshots

The Desktop screenshots in
[Projects and Workspaces](../use/projects-and-workspaces.md) come from the real
renderer, driven by WebdriverIO against the fixture app with mocked native
commands. They are not mockups, and they are not hand-cropped.

## Where the assets and the capture live

- Captured PNGs, served at `/screenshots/*.png`, 2× for retina displays:
  `docs/public/screenshots/desktop-{projects,run-composer,run-workspace}.png`.
- Capture spec: `apps/agent-desktop-e2e/src/docs-capture.spec.ts`. It mocks the
  native commands with documentation-friendly data (`research-bot`, the
  "Research workspace" project, a "Laptop" location at `/Users/you/research`),
  then walks Projects, the composer, and a finished run's detail.
- Config: `apps/agent-desktop-e2e/wdio.docs.conf.ts`, which sets the window size
  and `--force-device-scale-factor=2`, and writes into
  `docs/public/screenshots`.

The capture is a separate Nx configuration, so the normal journeys never
overwrite the committed images.

## Regenerating

No Docker stack or daemon is needed: the fixture app serves the renderer and the
native commands are mocked.

```bash
pnpm exec nx run @moltnet/agent-desktop-e2e:e2e --configuration=docs-capture
```

Review the three PNGs before committing them. Timestamps in the run detail are
relative ("2 hours ago"), so they change on every capture; that is expected.

## When to regenerate

Regenerate when the Projects screen, the composer's effective run settings, or
the captured-workspace panel changes shape or wording. Update the alt text in
the guide in the same change: it describes what each screenshot shows, and it is
what screen-reader users get instead of the image.
