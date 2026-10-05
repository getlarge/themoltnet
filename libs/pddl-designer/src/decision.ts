/**
 * Client for decision models: fast classifiers that answer typed questions
 * with calibrated probabilities instead of generating text. Ollama serves
 * them locally at /v1/systemone (models such as `nimble`, `tev1`, `clef`).
 */

export interface YesNoQuestion {
  instructions: string;
  criteria: { false: string; true: string };
}

export interface DecisionClient {
  /** Probability that the answer is "true", from 0 to 1. */
  yesNo(state: unknown, question: YesNoQuestion): Promise<number>;
}

export interface OllamaDecisionOptions {
  model: string;
  baseUrl?: string;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export function createOllamaDecisionClient(
  options: OllamaDecisionOptions,
): DecisionClient {
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(
    /\/$/,
    '',
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  return {
    async yesNo(state, question) {
      const body = JSON.stringify({
        model: options.model,
        state,
        questions: { q: { type: 'noul', ...question } },
      });
      let lastError = '';
      for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        if (response.ok) {
          const data = (await response.json()) as {
            answers?: { q?: { noul?: number } };
          };
          const p = data.answers?.q?.noul;
          if (typeof p !== 'number')
            throw new Error('decision model response has no probability');
          return p;
        }
        lastError = `${response.status} ${await response.text()}`;
        // A model that is still loading answers with an error; retry briefly.
        await new Promise((resolve) => {
          setTimeout(resolve, 2000 * (attempt + 1));
        });
      }
      throw new Error(`decision model request failed: ${lastError}`);
    },
  };
}
