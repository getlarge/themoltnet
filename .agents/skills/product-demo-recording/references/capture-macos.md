# macOS capture choices

Use this reference when the demo is captured from a native macOS application or
from a browser session that cannot be reproduced in a clean automated viewport.

## Choose the surface

Use the first suitable option:

1. **Browser viewport recorder** for reproducible web flows. It produces the
   cleanest boundary and avoids browser chrome, desktop exposure, and manual
   crop geometry.
2. **Exact native window capture** when the flow depends on an existing browser
   profile, local authentication, extensions, or native application state.
3. **Interactive window selection** when an exact identifier is unavailable
   but the operator can select and verify one window.

Do not use a display or coordinate-region recording for ordinary product demos.
Another application, notification, or moved window can enter that boundary.

## Exact window capture

When the automation surface reports a Core Graphics window identifier, use that
identifier directly with the native window-only recorder:

```bash
screencapture -v -l <CG_WINDOW_ID> /private/tmp/demo-raw.mov
```

Take a still with the same window identifier first and inspect it. Confirm that
the identifier belongs to the intended window and that the captured dimensions
include all four window edges.

Window identifiers can change when a window or application is recreated. Do
not reuse an identifier after restarting the app without resolving it again.

## Compose the frame instead of guessing a crop

Resize the window and application layout before recording. If browser chrome
must remain, include it completely. If it must be absent, prefer a viewport
recorder; otherwise calibrate the content rectangle from a still and verify all
four resulting edges before recording the real flow.

Avoid these failure modes:

- cropping away only part of the tab bar, toolbar, sidebar, status bar, or
  rounded window edge;
- cutting content because a source aspect ratio differs from the delivery
  aspect ratio;
- zooming a raster crop until labels soften;
- changing crop coordinates between takes without recalibration.

To preserve content while normalizing a source to 1440x810, scale and pad:

```bash
ffmpeg -i source.mov \
  -vf "scale=1440:810:force_original_aspect_ratio=decrease,pad=1440:810:(ow-iw)/2:(oh-ih)/2" \
  -r 30 -c:v libx264 -pix_fmt yuv420p -threads 1 -movflags +faststart \
  output.mp4
```

Use a deliberate background or frame color when padding is visible. Do not use
padding to conceal a framing mistake.

## Decode frames reliably

For exact visual inspection, seek after opening the input so FFmpeg decodes
forward to the requested timestamp:

```bash
ffmpeg -threads 1 -i final.mp4 \
  -vf "fps=30,trim=start=6,setpts=PTS-STARTPTS" \
  -frames:v 1 -q:v 2 frame-006.jpg
```

Putting `-ss` before `-i` performs input seeking and can return a misleading or
partially reconstructed frame around long GOP boundaries. Normalize to the
source frame rate before trimming so reference frames are materialized. The
bundled QA helper reads the real frame rate and applies this sequentially and
single-threaded.

The helper uses JPEG inspection exports to keep the QA directory compact and
consistent with its contact sheet. The image-preview path has intermittently
rendered identical image bytes differently regardless of format. If one preview
looks corrupt, verify its checksum is unchanged, reopen it, and inspect the
source video in a native player before diagnosing an encoder defect.
