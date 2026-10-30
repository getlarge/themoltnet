import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

// Execute only our generated clean fixture, not historical repository code.
const root = resolve(process.argv[2] ?? '/tmp/review-guidance-eval-corrected');
const input = JSON.parse(
  readFileSync(`${root}/inputs/clean-baseline.json`, 'utf8'),
);
const body = input.brief.slice(input.brief.indexOf('@@ '));
const source = body
  .split('\n')
  .slice(1)
  .filter(
    (line: string) =>
      line.startsWith(' ') || (line.startsWith('+') && !line.startsWith('+++')),
  )
  .map((line: string) => line.slice(1))
  .join('\n');
const javascript = ts.transpileModule(source.replace(/^export /gm, ''), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;
const sandbox = { result: undefined as unknown };
runInNewContext(`${javascript}\nresult = { docsResult, render };`, sandbox, {
  timeout: 1000,
});
const fixture = sandbox.result as {
  docsResult(report: unknown): {
    status: string;
    unclear: string[];
    findings: unknown[];
  };
  render(result: unknown): string;
};
let checked = 0;
for (const outcome of ['not-needed', 'updates-needed', 'incomplete']) {
  for (const findings of [
    [],
    [{ docsPath: 'docs/usage.md', update: 'Describe new flag' }],
  ]) {
    for (const gaps of [
      [],
      [{ scope: 'docs-check stage', reason: 'budget exhausted' }],
    ]) {
      const result = fixture.docsResult({ outcome, findings, gaps });
      assert.equal(
        result.status,
        outcome === 'updates-needed'
          ? 'concern'
          : outcome === 'incomplete'
            ? 'unclear'
            : 'clear',
      );
      assert.equal(result.findings.length, findings.length);
      assert.equal(result.unclear.length, gaps.length);
      const rendered = fixture.render(result);
      assert.equal(
        rendered.includes(
          'Not fully assessed: docs-check stage: budget exhausted',
        ),
        gaps.length > 0,
      );
      assert.equal(rendered.includes('Describe new flag'), findings.length > 0);
      checked++;
    }
  }
}
writeFileSync(
  `${root}/control-validation.json`,
  JSON.stringify(
    { checked, passed: checked, allOutcomesPreserveGaps: true },
    null,
    2,
  ) + '\n',
);
console.log(
  `Validated ${checked} clean fixture outcome/findings/gaps combinations`,
);
