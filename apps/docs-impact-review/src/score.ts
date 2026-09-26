import { type Static, Type } from 'typebox';
import { Value } from 'typebox/value';

import {
  type DocsFinding,
  type DocsImpactReport,
  FINDING_ISSUES,
} from './types.js';

const Label = Type.Object(
  {
    docsPath: Type.Optional(Type.String({ minLength: 1 })),
    mentions: Type.Optional(Type.String({ minLength: 1 })),
    issue: Type.Optional(
      Type.Union(FINDING_ISSUES.map((issue) => Type.Literal(issue))),
    ),
    note: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
type Label = Static<typeof Label>;

const Labels = Type.Object(
  {
    version: Type.Literal(1),
    prs: Type.Record(
      Type.String({ pattern: '^[0-9]+$' }),
      Type.Object(
        {
          expected: Type.Optional(Type.Array(Label)),
          forbidden: Type.Optional(Type.Array(Label)),
          note: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type Labels = Static<typeof Labels>;

export function parseLabels(value: unknown): Labels {
  if (!Value.Check(Labels, value)) {
    const [first] = Value.Errors(Labels, value);
    throw new Error(
      `invalid labels at ${first?.instancePath || '(root)'}: ${first?.message}`,
    );
  }
  return value;
}

/** A label matches on location and/or content; the issue is scored apart. */
function matches(label: Label, finding: DocsFinding): boolean {
  if (label.docsPath && label.docsPath !== finding.docsPath) return false;
  if (label.mentions) {
    const needle = label.mentions.toLowerCase();
    const text = `${finding.update} ${finding.evidence.detail}`.toLowerCase();
    if (!text.includes(needle)) return false;
  }
  return Boolean(label.docsPath || label.mentions);
}

export interface PrScore {
  pr: number;
  labeled: boolean;
  outcome: string;
  expected: number;
  found: number;
  forbiddenHits: number;
  unlabeledFindings: number;
  issueMismatches: number;
}

export interface CorpusScore {
  prs: PrScore[];
  /** Expected findings reported / expected findings labeled. */
  recall: number | null;
  /** Findings matching an expected label / findings matching any label. */
  precision: number | null;
  issueAccuracy: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function scoreReports(
  reports: DocsImpactReport[],
  labels: Labels,
): CorpusScore {
  const prs: PrScore[] = [];
  let expected = 0;
  let found = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let issueChecked = 0;
  let issueCorrect = 0;
  for (const report of reports) {
    const entry = labels.prs[String(report.pr)];
    const expectedLabels = entry?.expected ?? [];
    const forbiddenLabels = entry?.forbidden ?? [];
    const score: PrScore = {
      pr: report.pr,
      labeled: Boolean(entry),
      outcome: report.status === 'failed' ? 'failed' : String(report.outcome),
      expected: expectedLabels.length,
      found: 0,
      forbiddenHits: 0,
      unlabeledFindings: 0,
      issueMismatches: 0,
    };
    for (const label of expectedLabels) {
      const hit = report.findings.find((finding) => matches(label, finding));
      if (!hit) continue;
      score.found += 1;
      if (label.issue) {
        issueChecked += 1;
        if (hit.issue === label.issue) issueCorrect += 1;
        else score.issueMismatches += 1;
      }
    }
    for (const finding of report.findings) {
      if (expectedLabels.some((label) => matches(label, finding))) {
        truePositives += 1;
      } else if (forbiddenLabels.some((label) => matches(label, finding))) {
        falsePositives += 1;
        score.forbiddenHits += 1;
      } else {
        score.unlabeledFindings += 1;
      }
    }
    expected += score.expected;
    found += score.found;
    prs.push(score);
  }
  return {
    prs,
    recall: ratio(found, expected),
    precision: ratio(truePositives, truePositives + falsePositives),
    issueAccuracy: ratio(issueCorrect, issueChecked),
  };
}
