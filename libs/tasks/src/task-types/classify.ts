import { type Static, Type } from 'typebox';

export const CLASSIFY_TYPE = 'classify' as const;
const text = Type.String({ minLength: 1 });
const probability = Type.Number({ minimum: 0, maximum: 1 });
const strict = { additionalProperties: false };

export const ClassificationQuestion = Type.Union([
  Type.Object(
    {
      type: Type.Literal('choice'),
      instructions: text,
      criteria: Type.Record(text, text, { minProperties: 2 }),
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal('score'),
      instructions: text,
      criteria: Type.Array(text, { minItems: 2 }),
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal('bool'),
      instructions: text,
      criteria: Type.Object({ true: text, false: text }, strict),
    },
    strict,
  ),
]);

export const ClassifyInput = Type.Object(
  {
    version: Type.Literal(1),
    state: Type.Record(Type.String(), Type.Unknown()),
    questions: Type.Record(text, ClassificationQuestion, { minProperties: 1 }),
  },
  { $id: 'ClassifyInput', ...strict },
);
export type ClassifyInput = Static<typeof ClassifyInput>;

export const ClassificationAnswer = Type.Union([
  Type.Object(
    {
      type: Type.Literal('choice'),
      choice: text,
      probabilities: Type.Record(text, probability),
      confidence: probability,
    },
    strict,
  ),
  Type.Object(
    {
      type: Type.Literal('score'),
      score: Type.Number({ minimum: 0 }),
      confidence: probability,
    },
    strict,
  ),
  Type.Object({ type: Type.Literal('bool'), probability }, strict),
]);

export const ClassifyOutput = Type.Object(
  {
    version: Type.Literal(1),
    provider: text,
    model: text,
    answers: Type.Record(text, ClassificationAnswer),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Integer({ minimum: 0 }),
          outputTokens: Type.Integer({ minimum: 0 }),
        },
        strict,
      ),
    ),
  },
  { $id: 'ClassifyOutput', ...strict },
);
export type ClassifyOutput = Static<typeof ClassifyOutput>;

/** Runs after structural validation, on both executor and server. */
export function validateClassifyOutput(
  output: unknown,
  input?: unknown,
): string | null {
  if (!input) return 'Classification requires its question contract';
  const { questions } = input as ClassifyInput;
  const { answers } = output as ClassifyOutput;
  if (Object.keys(questions).length !== Object.keys(answers).length) {
    return 'Classification must answer exactly the requested questions';
  }
  for (const [key, question] of Object.entries(questions)) {
    const answer = answers[key];
    if (!answer || answer.type !== question.type)
      return `Invalid answer type for ${key}`;
    if (question.type === 'choice' && answer.type === 'choice') {
      const choices = Object.keys(question.criteria);
      if (
        !choices.includes(answer.choice) ||
        choices.length !== Object.keys(answer.probabilities).length ||
        choices.some((choice) => !Object.hasOwn(answer.probabilities, choice))
      ) {
        return `Invalid choices for ${key}`;
      }
      const sum = Object.values(answer.probabilities).reduce(
        (a, b) => a + b,
        0,
      );
      if (Math.abs(sum - 1) > 0.001)
        return `Probabilities must sum to one for ${key}`;
    }
    if (
      question.type === 'score' &&
      answer.type === 'score' &&
      answer.score > question.criteria.length - 1
    )
      return `Score out of range for ${key}`;
  }
  return null;
}
