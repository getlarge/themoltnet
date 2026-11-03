// Stand-in for @huggingface/transformers, loaded inside the embedding worker.
// Inference busy-waits to reproduce the CPU-bound, event-loop-blocking
// behaviour of the real ONNX pipeline.
export const env = {
  allowLocalModels: false,
  allowRemoteModels: true,
  localModelPath: '',
};

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin
  }
}

export async function pipeline(_task, modelId) {
  if (modelId === 'fail-load') throw new Error('model load failed');
  return async ([text]) => {
    const busy = /busy:(\d+)/.exec(text);
    if (busy) busyWait(Number(busy[1]));
    if (text.includes('crash')) process.exit(3);
    if (text.includes('throw')) throw new Error('inference failed');
    const vector = Array.from({ length: 384 }, () => 0);
    vector[text.startsWith('query: ') ? 1 : 0] = 2;
    return { tolist: () => [vector] };
  };
}
