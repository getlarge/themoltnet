import type { ModelCostRates } from '../src/types.js';

export type OllamaCloudPricing =
  | { cost: ModelCostRates; offPeakCost?: ModelCostRates }
  | { classifierCost: ModelCostRates };

/** Parse the published model table; never substitute zero for a missing price. */
export function parseOllamaCloudPricing(
  html: string,
): Map<string, OllamaCloudPricing> {
  const section = html.split('id="model-pricing"')[1];
  const table = section?.match(/<table\b[^>]*>([\s\S]*?)<\/table>/)?.[1];
  if (!table) throw new Error('Ollama pricing page has no model pricing table');
  const text = (cell: string) => {
    const value = cell.trim();
    const anchor = value.match(/^<a\b[^>]*>([^<>]*)<\/a>$/);
    if (anchor) return anchor[1].trim();
    if (/[<>]/.test(value))
      throw new Error('Unexpected markup in Ollama pricing cell');
    return value;
  };
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(
    (match) => text(match[1]),
  );
  if (headers.join(',') !== 'Model,Input,Cached input,Output') {
    throw new Error('Ollama pricing table columns changed');
  }
  const price = (value: string): number => {
    if (!/^\$\d+(\.\d+)?$/.test(value))
      throw new Error(`Invalid Ollama token price: ${value}`);
    return Number(value.slice(1));
  };
  const prices = new Map<string, OllamaCloudPricing>();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(
      (match) => text(match[1]),
    );
    if (!cells.length) continue;
    if (cells.length !== 4) throw new Error('Invalid Ollama model pricing row');
    const [name, input, cacheRead, output] = cells;
    const id = name.replace(/ \(Off-Peak\)$/, '');
    const existing = prices.get(id);
    // Without a cache discount, input is charged at the ordinary input rate.
    const cacheReadRate = cacheRead === '-' ? price(input) : price(cacheRead);
    if (output === '-') {
      // An input-only classifier emits no output tokens. Its rate stays out
      // of `cost`, so no chat model is ever priced at a zero output rate.
      // Off-peak classifier rates are not used.
      if (id !== name) continue;
      if (existing) throw new Error(`Duplicate Ollama model price: ${id}`);
      prices.set(id, {
        classifierCost: {
          input: price(input),
          output: 0,
          cacheRead: cacheReadRate,
          cacheWrite: 0,
        },
      });
      continue;
    }
    const cost = {
      input: price(input),
      output: price(output),
      cacheRead: cacheReadRate,
      cacheWrite: 0,
    };
    if (id !== name) {
      if (!existing || !('cost' in existing) || existing.offPeakCost)
        throw new Error(`Unexpected Ollama off-peak row: ${name}`);
      existing.offPeakCost = cost;
    } else {
      if (existing) throw new Error(`Duplicate Ollama model price: ${id}`);
      prices.set(id, { cost });
    }
  }
  if (![...prices.values()].some((pricing) => 'cost' in pricing))
    throw new Error('Ollama pricing table has no chat prices');
  return prices;
}
