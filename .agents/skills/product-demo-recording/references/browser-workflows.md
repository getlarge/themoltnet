# Browser workflow recordings

Use this reference for browser-based workflow builders such as n8n and
Node-RED, especially when the execution includes polling, retries, or a daemon
that completes work asynchronously.

## Capture a fixed viewport

Set the browser viewport to the final 16:9 dimensions before arranging the
workflow. Capture the viewport pixels directly when the automation surface
supports it; this excludes tabs, browser chrome, other applications, and the
desktop without relying on a crop.

Verify these invariants on a still before executing:

- the screenshot dimensions equal the delivery dimensions;
- the whole workflow and every intended application edge are visible;
- labels remain readable at the docs embed size;
- no credential editor, unrelated account data, or personal browser surface is
  present.

If continuous viewport recording is unavailable, capture sequential PNG stills
at a stable cadence. Keep the viewport size and application zoom unchanged for
the whole sequence. Sequential stills are an acceptable source when they show
the real ordered execution rather than a reconstructed outcome.

## Separate setup from the take

Create and test credentials before recording. Start the take only after the
integration reports a successful connection, and avoid reopening the
credential editor. Use a short-lived, least-privilege demo credential when the
environment supports one, but never expose it in a frame or build artifact.

Run the actual external worker or daemon needed to complete the workflow. A
green trigger or accepted API request is not the terminal outcome when another
process must claim and finish the task.

## Compress polling without falsifying it

Show the first creation state, enough of the wait loop to make the asynchronous
behavior clear, the terminal workflow state, and the accepted result. Accelerate
or remove repeated idle polling frames; do not make viewers watch the service's
wall-clock latency.

For a numbered PNG sequence captured once per second, a higher input frame rate
compresses the real sequence while preserving its order:

```bash
ffmpeg -framerate 8 -start_number 1 -i success-%03d.png \
  -vf "fps=30,format=yuv420p,setsar=1" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p execution.mp4
```

Choose the input rate based on the amount of repetition. The UI must remain
legible enough to understand state changes; important configuration and result
frames should be separate normal-speed holds rather than part of the accelerated
sequence.

Open the terminal result or output panel and capture it as its own shot. Hold it
long enough to read the task status, acceptance state, summary, and verification
signal. Park the pointer away from those values.

## Assemble and verify

Prefer clean cuts between a style card, the native workflow, the completed
workflow, the terminal result, and the end card. Short fades are appropriate
for authored overlays, but crossfading changing application states can create a
false-looking hybrid frame.

Include the boundaries around the accelerated sequence and result hold in the
QA helper timestamps. Also inspect any time range called out in earlier review
feedback, even if the edit changed completely.
