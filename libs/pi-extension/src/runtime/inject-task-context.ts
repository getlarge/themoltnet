/**
 * Slice 1.5 of #943 — wire the agent-runtime resolver into the
 * pi-extension execution path.
 *
 * `resolveTaskContext` is a pure dispatcher; this module provides the
 * Gondolin-aware deliverer and the post-resolution shape the
 * `execute-pi-task` caller needs to splice into pi's setup:
 *
 *   - `systemPromptPrefix` → fed into `appendSystemPrompt` alongside
 *      the runtime instructor (it IS a system-prompt fragment).
 *   - `userInlineSuffix`   → appended to the `buildTaskUserPrompt`
 *      output BEFORE `session.prompt(text)`.
 *   - `skills`             → spliced into the `skillsOverride` callback's
 *      return value. pi includes them in `<available_skills>` in the
 *      system prompt; the agent fetches the body on demand via the
 *      Read tool.
 *
 * Skill files are written into the VM at
 * `/workspace/.moltnet/skills/<slug>/SKILL.md`. The agent's
 * Gondolin-bound Read tool is scoped to `/workspace`, so that path is
 * the only location the agent can actually read at runtime. pi only
 * reads `<available_skills>` metadata (name, description, location),
 * never the file body, so we construct synthetic `Skill` objects
 * pointing at the in-VM path without ever materialising the file on
 * the host.
 */
import {
  createSyntheticSourceInfo,
  parseFrontmatter,
  type Skill,
  type SkillFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
  type ContextRef,
  resolveTaskContext,
  type TaskContext,
} from '@themoltnet/agent-runtime';

import { GUEST_TASK_SKILLS_MOUNT } from '../vm-manager.js';

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
 * Where in the VM we write skill bodies — the memory-backed mount
 * declared in `vm-manager.ts`. See the comment on
 * `GUEST_TASK_SKILLS_MOUNT` there for the full rationale (ephemeral
 * by intent + the worktree symlink interaction with Gondolin's
 * sandbox-escape protection). The agent's Gondolin Read tool accepts
 * paths under this mount via `toGuestPath` in `tool-operations.ts`.
 */
const SKILL_ROOT_IN_VM = GUEST_TASK_SKILLS_MOUNT;

/** Bounds borrowed from pi's skill validation; conservative caps so a
 *  malformed SKILL.md doesn't bloat the system prompt. */
const MAX_SKILL_NAME = 64;
const MAX_SKILL_DESCRIPTION = 1024;

export interface InjectedTaskContext {
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

export interface InjectTaskContextArgs {
  /** Empty array (the default for any non-eval task) is a no-op. */
  context: TaskContext;
  /** Guest filesystem handle. In production this is `managed.vm.fs`. */
  fs: VmFsForContext;
}

/**
 * Resolve a task's `input.context[]` and inject the side effects pi
 * needs. Safe to call with an empty array — returns an inert result.
 */
export async function injectTaskContext(
  args: InjectTaskContextArgs,
): Promise<InjectedTaskContext> {
  const skills: Skill[] = [];

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
    },
  });

  return {
    injected: resolved.injected,
    skills,
    systemPromptPrefix: resolved.systemPromptPrefix,
    userInlineSuffix: resolved.userInlineSuffix,
  };
}

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
      : `Task-injected context skill (${args.slug})`,
    MAX_SKILL_DESCRIPTION,
  );

  return {
    name,
    description,
    filePath: args.filePath,
    baseDir: args.dir,
    sourceInfo: createSyntheticSourceInfo(args.filePath, {
      source: 'moltnet:task-context',
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
