/**
 * Pi-specific runtime context handling.
 *
 * `@themoltnet/agent-runtime` owns generic context semantics: merge profile
 * defaults with task context, resolve bindings, and produce prompt fragments.
 * This module owns the Pi/Gondolin boundary: validate effective context for an
 * attempt, write skill/context files into the VM, and build synthetic Pi Skill
 * metadata for injected skill bindings.
 */
import {
  createSyntheticSourceInfo,
  parseFrontmatter,
  type Skill,
  type SkillFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
  type ContextRef,
  mergeRuntimeProfileContext,
  resolveTaskContext,
  TaskContext,
} from '@themoltnet/agent-runtime';
import { Value } from 'typebox/value';

import { GUEST_TASK_CONTEXT_MOUNT } from '../vm-manager.js';

/**
 * Subset of `@earendil-works/gondolin`'s `VmFs` we actually use. We
 * narrow the dependency surface so unit tests can hand in a
 * vitest-mocked object without instantiating a real VM. We use `any`
 * for the options parameter to make this interface bivariantly
 * compatible with `VmFs` (whose options types differ between
 * `mkdir` and `writeFile`); the orchestrator only ever calls these
 * methods with the documented option shape, so the looseness is
 * confined to this seam.
 */
export interface VmFsForContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mkdir: (dirPath: string, options?: any) => Promise<void>;
  writeFile: (
    filePath: string,
    data: string | Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any,
  ) => Promise<void>;
}

/**
 * Where in the VM we write runtime-context bodies — the memory-backed mount
 * declared in `vm-manager.ts`. See the comment on
 * `GUEST_TASK_CONTEXT_MOUNT` there for the full rationale (ephemeral by
 * intent + the worktree symlink interaction with Gondolin's sandbox-escape
 * protection). The agent's Gondolin Read tool accepts paths under this mount
 * via `toGuestPath` in `tool-operations.ts`.
 */
const SKILL_ROOT_IN_VM = `${GUEST_TASK_CONTEXT_MOUNT}/skills`;
const INLINE_CONTEXT_ROOT_IN_VM = `${GUEST_TASK_CONTEXT_MOUNT}/context`;
/** Bounds borrowed from pi's skill validation; conservative caps so a
 *  malformed SKILL.md doesn't bloat the system prompt. */
const MAX_SKILL_NAME = 64;
const MAX_SKILL_DESCRIPTION = 1024;

export interface InjectedRuntimeContext {
  /** Refs that were delivered, in declared order, for audit. */
  injected: ContextRef[];
  /** Synthetic Skill objects to splice into pi's skillsOverride. */
  skills: Skill[];
  /** Prepend this to `appendSystemPrompt`. Empty when nothing
   *  contributed (omit the array entry rather than pass an empty
   *  string to keep pi's prompt assembly tidy). */
  systemPromptPrefix: string;
  /** Append this to the task user prompt BEFORE `session.prompt()`. */
  userInlineSuffix: string;
}

export interface InjectRuntimeContextArgs {
  /** Empty array (the default for any non-eval task) is a no-op. */
  context: readonly ContextRef[];
  /** Guest filesystem handle. In production this is `managed.vm.fs`. */
  fs: VmFsForContext;
  /** Guest path where the active host workspace is mounted. */
  guestWorkspace: string;
}

export function resolveEffectiveRuntimeContext(args: {
  rawTaskContext: unknown;
  runtimeProfileContext?: readonly ContextRef[];
}): ContextRef[] {
  const taskContext =
    args.rawTaskContext === undefined ? [] : args.rawTaskContext;
  if (!Value.Check(TaskContext, taskContext)) {
    throw new Error(
      `task.input.context failed TaskContext validation: ${JSON.stringify(
        [...Value.Errors(TaskContext, taskContext)].slice(0, 3),
      )}`,
    );
  }

  const profileContext = args.runtimeProfileContext ?? [];
  if (!Value.Check(TaskContext, profileContext)) {
    throw new Error(
      `runtime profile context failed TaskContext validation: ${JSON.stringify(
        [...Value.Errors(TaskContext, profileContext)].slice(0, 3),
      )}`,
    );
  }

  return mergeRuntimeProfileContext(
    profileContext,
    taskContext as readonly ContextRef[],
  );
}

/**
 * Resolve effective runtime context and inject the side effects Pi
 * needs. Safe to call with an empty array — returns an inert result.
 */
export async function injectRuntimeContext(
  args: InjectRuntimeContextArgs,
): Promise<InjectedRuntimeContext> {
  const skills: Skill[] = [];
  void args.guestWorkspace;

  const resolved = await resolveTaskContext({
    context: args.context,
    deliver: {
      skill: async ({ slug, content }) => {
        const dir = `${SKILL_ROOT_IN_VM}/${slug}`;
        const filePath = `${dir}/SKILL.md`;
        await args.fs.mkdir(dir, { recursive: true });
        await args.fs.writeFile(filePath, content, { mode: 0o644 });
        skills.push(buildSyntheticSkill({ slug, content, filePath, dir }));
      },
      contextFile: async ({ suggestedFileName, content }) => {
        await args.fs.mkdir(INLINE_CONTEXT_ROOT_IN_VM, { recursive: true });
        const filePath = `${INLINE_CONTEXT_ROOT_IN_VM}/${suggestedFileName}`;
        await args.fs.writeFile(filePath, content, { mode: 0o644 });
      },
    },
  });

  return {
    injected: resolved.injected,
    skills,
    systemPromptPrefix: resolved.systemPromptPrefix,
    userInlineSuffix: resolved.userInlineSuffix,
  };
}

export {
  type InjectedRuntimeContext as InjectedTaskContext,
  injectRuntimeContext as injectTaskContext,
  type InjectRuntimeContextArgs as InjectTaskContextArgs,
  mergeRuntimeProfileContext,
};

/**
 * Build a `Skill` object pi will faithfully render in
 * `<available_skills>`. We extract `name` and `description` from the
 * skill content's YAML frontmatter using pi's own `parseFrontmatter`
 * helper (proper YAML, not a regex hack) and fall back to the slug +
 * a generic description so a SKILL.md without frontmatter still
 * renders something meaningful.
 *
 * Frontmatter parsing is best-effort: a malformed YAML block is
 * optional metadata, not a reason to fail the task. We swallow parser
 * errors and fall back to the slug-derived metadata; the skill body
 * is unaffected.
 *
 * pi's `formatSkillsForPrompt` only reads `name`, `description`, and
 * `filePath` — `sourceInfo`/`baseDir` exist on the type but never
 * surface in the prompt, so a synthetic `SourceInfo` is enough.
 */
function buildSyntheticSkill(args: {
  slug: string;
  content: string;
  filePath: string;
  dir: string;
}): Skill {
  let fm: Partial<SkillFrontmatter> = {};
  try {
    fm = parseFrontmatter<SkillFrontmatter>(args.content).frontmatter;
  } catch {
    // Malformed YAML frontmatter; fall back to slug-derived metadata.
    // The slug surfaces in the description so the operator can still
    // identify which entry has the bad YAML.
  }
  const name = clip(
    typeof fm.name === 'string' && fm.name.trim().length > 0
      ? fm.name.trim()
      : args.slug,
    MAX_SKILL_NAME,
  );
  const description = clip(
    typeof fm.description === 'string' && fm.description.trim().length > 0
      ? fm.description.trim()
      : `Runtime-injected context skill (${args.slug})`,
    MAX_SKILL_DESCRIPTION,
  );

  return {
    name,
    description,
    filePath: args.filePath,
    baseDir: args.dir,
    sourceInfo: createSyntheticSourceInfo(args.filePath, {
      source: 'moltnet:runtime-context',
      scope: 'temporary',
      origin: 'top-level',
      baseDir: args.dir,
    }),
    disableModelInvocation: fm['disable-model-invocation'] === true,
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
