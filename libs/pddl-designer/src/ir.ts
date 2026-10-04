/**
 * Typed intermediate representation of a planning domain and problem.
 *
 * Each LLM stage returns one of these objects through a freeform task's
 * `outputContract`. The contract transport cannot express `pattern`, `null`,
 * or unions, so those rules live here and are re-checked by the stage parsers
 * after the daemon has accepted the result.
 *
 * Preconditions and effects are structured atoms, never free text, so PDDL is
 * rendered by code (render.ts) instead of being written by a model.
 */
import { type Static, Type } from 'typebox';

/** PDDL name: lowercase, starts with a letter, hyphen-separated. */
export const NAME_PATTERN = '^[a-z][a-z0-9-]{0,39}$';
/** Action/predicate parameter variable, e.g. `?c`. */
export const VAR_PATTERN = '^\\?[a-z][a-z0-9-]{0,39}$';
/** Problem object name, e.g. `issue-101`, `wt-1`. */
export const OBJECT_PATTERN = '^[a-z][a-z0-9_-]{0,39}$';

const Name = Type.String({
  pattern: NAME_PATTERN,
  minLength: 1,
  maxLength: 40,
});
const Note = (maxLength: number) => Type.String({ minLength: 1, maxLength });

export const ParameterSchema = Type.Object(
  {
    name: Type.String({ pattern: VAR_PATTERN, minLength: 2, maxLength: 41 }),
    type: Name,
  },
  { additionalProperties: false },
);

/** A fact with arguments that are action parameters (domain) or objects (problem). */
export const AtomSchema = Type.Object(
  {
    predicate: Name,
    args: Type.Array(Type.String({ minLength: 1, maxLength: 41 }), {
      maxItems: 8,
    }),
  },
  { additionalProperties: false },
);

/** An atom that must hold (`negated: false`) or must not hold (`negated: true`). */
export const LiteralSchema = Type.Object(
  {
    predicate: Name,
    args: Type.Array(Type.String({ minLength: 1, maxLength: 41 }), {
      maxItems: 8,
    }),
    negated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const TypeDefSchema = Type.Object(
  {
    name: Name,
    /** Omit for a direct child of PDDL's root type `object`. */
    parent: Type.Optional(Name),
    description: Note(200),
  },
  { additionalProperties: false },
);

export const PredicateDefSchema = Type.Object(
  {
    name: Name,
    parameters: Type.Array(ParameterSchema, { maxItems: 6 }),
    description: Note(200),
  },
  { additionalProperties: false },
);

export const ActionDefSchema = Type.Object(
  {
    name: Name,
    parameters: Type.Array(ParameterSchema, { maxItems: 10 }),
    preconditions: Type.Array(LiteralSchema, { maxItems: 20 }),
    addEffects: Type.Array(AtomSchema, { maxItems: 20 }),
    deleteEffects: Type.Array(AtomSchema, { maxItems: 20 }),
    /** The sentence of the description this action models. */
    source: Note(400),
  },
  { additionalProperties: false },
);

export const ObjectDefSchema = Type.Object(
  {
    name: Type.String({ pattern: OBJECT_PATTERN, minLength: 1, maxLength: 40 }),
    type: Name,
  },
  { additionalProperties: false },
);

// ---- stage results ----------------------------------------------------------

export const TypesResultSchema = Type.Object(
  { types: Type.Array(TypeDefSchema, { minItems: 1, maxItems: 30 }) },
  { additionalProperties: false },
);

export const PredicatesResultSchema = Type.Object(
  { predicates: Type.Array(PredicateDefSchema, { minItems: 1, maxItems: 60 }) },
  { additionalProperties: false },
);

export const ActionsResultSchema = Type.Object(
  { actions: Type.Array(ActionDefSchema, { minItems: 1, maxItems: 30 }) },
  { additionalProperties: false },
);

export const RefineResultSchema = Type.Object(
  {
    actions: Type.Array(ActionDefSchema, { minItems: 1, maxItems: 30 }),
    /** One line per change, citing the description or the issue it fixes. */
    changes: Type.Array(Note(300), { maxItems: 30 }),
  },
  { additionalProperties: false },
);

export const ProblemResultSchema = Type.Object(
  {
    objects: Type.Array(ObjectDefSchema, { minItems: 1, maxItems: 60 }),
    init: Type.Array(AtomSchema, { maxItems: 100 }),
    goal: Type.Array(LiteralSchema, { minItems: 1, maxItems: 30 }),
  },
  { additionalProperties: false },
);

export type Parameter = Static<typeof ParameterSchema>;
export type Atom = Static<typeof AtomSchema>;
export type Literal = Static<typeof LiteralSchema>;
export type TypeDef = Static<typeof TypeDefSchema>;
export type PredicateDef = Static<typeof PredicateDefSchema>;
export type ActionDef = Static<typeof ActionDefSchema>;
export type ObjectDef = Static<typeof ObjectDefSchema>;
export type TypesResult = Static<typeof TypesResultSchema>;
export type PredicatesResult = Static<typeof PredicatesResultSchema>;
export type ActionsResult = Static<typeof ActionsResultSchema>;
export type RefineResult = Static<typeof RefineResultSchema>;
export type ProblemResult = Static<typeof ProblemResultSchema>;

export interface Domain {
  name: string;
  types: TypeDef[];
  predicates: PredicateDef[];
  actions: ActionDef[];
}

export interface Problem {
  name: string;
  objects: ObjectDef[];
  init: Atom[];
  goal: Literal[];
}
