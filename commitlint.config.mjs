/**
 * Conventional-commit rules for this repo, with one addition that is not
 * stylistic: breaking-change markers are refused outright.
 *
 * Why: release-please turns a `!` after the type/scope, or a `BREAKING CHANGE:`
 * footer, into a MAJOR bump for every package whose files the commit touches —
 * including linked-versions siblings. AGENTS.md ("No major version bumps")
 * forbids majors unless the maintainer asks for one in the task at hand, and a
 * Go library module cannot publish v2+ at all without a `/vN` module path.
 *
 * A behaviour change is described in the commit body instead.
 */

/** Matches `type!:` and `type(scope)!:` in a commit header. */
const BANG_HEADER = /^[a-zA-Z]+(\([^)]*\))?!:/u;

/** Matches a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer at line start. */
const BREAKING_FOOTER = /^[ \t]*BREAKING[ -]CHANGE[ \t]*:/imu;

const GUIDANCE =
  'breaking-change markers are forbidden (AGENTS.md "No major version bumps"): ' +
  'release-please turns them into a major for every package the commit touches. ' +
  'Drop the "!" and any "BREAKING CHANGE:" footer, and describe the behaviour ' +
  'change in the commit body instead.';

const noBreakingChange = {
  rules: {
    'moltnet/no-breaking-change': (parsed) => {
      const header = parsed.header ?? '';
      const raw = parsed.raw ?? '';

      if (BANG_HEADER.test(header)) {
        return [false, `"!" breaking marker in the header — ${GUIDANCE}`];
      }
      // The parser lifts `BREAKING CHANGE:` into notes; the raw scan also
      // catches a footer the parser did not recognise (wrong casing, stray
      // indentation) so the ban cannot be sidestepped by formatting.
      const hasNote = (parsed.notes ?? []).some((note) =>
        /^BREAKING[ -]CHANGE$/iu.test(String(note.title ?? '').trim()),
      );
      if (hasNote || BREAKING_FOOTER.test(raw)) {
        return [false, `"BREAKING CHANGE:" footer — ${GUIDANCE}`];
      }
      return [true, ''];
    },
  },
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [noBreakingChange],
  rules: {
    'moltnet/no-breaking-change': [2, 'always'],

    // Release-please derives the changelog from these, so the type must be one
    // it understands. Mirrors config-conventional's list.
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],

    // Relaxed against this repo's existing history rather than the default:
    // long subjects are common here and rejecting them would block ordinary
    // work without improving the changelog.
    'header-max-length': [1, 'always', 100],
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
  },
  // Release-please and dependabot author these; they are not ours to reject.
  ignores: [
    (message) =>
      /^chore\(main\): release/u.test(message) ||
      /^Merge (pull request|branch|remote-tracking)/u.test(message) ||
      /^Revert "/u.test(message),
  ],
};
