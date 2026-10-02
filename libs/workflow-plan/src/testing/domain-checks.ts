import type { DomainCheck } from '../executor/types.js';

/** Synthetic evidence ids the citation check accepts. */
export const KNOWN_EVIDENCE_IDS = new Set(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);

/** Every `cites` entry anywhere in the output must be a known evidence id. */
export const citationsResolve: DomainCheck = (output) => {
  const problems: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}/${i}`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'cites' && Array.isArray(v)) {
          for (const id of v) {
            if (!KNOWN_EVIDENCE_IDS.has(String(id))) {
              problems.push(
                `${path}/cites references unknown evidence id '${String(id)}'`,
              );
            }
          }
        } else {
          visit(v, `${path}/${k}`);
        }
      }
    }
  };
  visit(output, '');
  return problems;
};
