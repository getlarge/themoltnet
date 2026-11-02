import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  annotation,
  backlog,
  backlogMarker,
  compare,
  normalize,
  publishBacklog,
  scan,
  summary,
} from '../knip-report.mjs';

const findings = (line = 4) =>
  normalize({
    issues: [
      {
        file: 'libs/demo/src/a.ts',
        exports: [{ name: 'unused', line }],
        owners: [{ name: '@getlarge' }],
      },
    ],
  });
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('Knip regression report', () => {
  it('ignores line churn, ordering and duplicate import occurrences', () => {
    const base = findings();
    const head = normalize({
      issues: [
        {
          file: base[0].file,
          exports: [
            { name: 'unused', line: 80 },
            { name: 'unused', line: 85 },
          ],
        },
      ],
    });
    expect(compare(base, head)).toEqual({ added: [], resolved: [] });
    expect(backlog(base).hash).toBe(backlog(head).hash);
  });

  it('reports additions and resolutions without showing the old backlog', () => {
    const old = findings();
    const head = normalize({
      issues: [
        {
          file: 'apps/demo/package.json',
          dependencies: [{ name: 'unused-package', line: 12 }],
        },
      ],
    });
    const delta = compare(old, head);
    expect(delta).toEqual({ added: head, resolved: old });
    const body = summary(head, delta, 'https://github.com/o/r/actions/runs/1');
    expect(body).toContain('1 new findings; 1 resolved');
    expect(body).toContain('unused-package');
    expect(body).not.toContain('libs/demo/src/a.ts');
    expect(body).toContain('knip-report artifact');
  });

  it('keeps duplicate groups and namespaced members distinct', () => {
    const result = normalize({
      issues: [
        {
          file: 'a.ts',
          duplicates: [[{ name: 'b' }, { name: 'a' }]],
          enumMembers: [
            { namespace: 'One', name: 'A' },
            { namespace: 'Two', name: 'A' },
          ],
        },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result.map((f) => f.name)).toEqual(
      expect.arrayContaining(['a, b', 'One.A', 'Two.A']),
    );
  });

  it('rejects malformed output and does not mistake tool failure for findings', () => {
    expect(() => normalize({})).toThrow('issues array');
    expect(() =>
      normalize({ issues: [{ file: 'a.ts', exports: {} }] }),
    ).toThrow('category');
    const dir = mkdtempSync(join(tmpdir(), 'knip-report-'));
    temporary.push(dir);
    const bin = join(dir, 'fake.mjs');
    writeFileSync(
      bin,
      'console.log(JSON.stringify({issues: []})); process.exit(2);',
    );
    expect(() => scan(dir, bin, dir, 'head')).toThrow('analysis failed');
    writeFileSync(bin, 'console.log("not json"); process.exit(1);');
    expect(() => scan(dir, bin, dir, 'head')).toThrow('invalid report');
    writeFileSync(
      bin,
      'console.log(JSON.stringify({issues: [{file:"a.ts",files:[{name:"a.ts"}]}]})); process.exit(1);',
    );
    expect(scan(dir, bin, dir, 'head')).toHaveLength(1);
  });

  it('escapes Markdown and workflow-command input and caps the summary', () => {
    const hostile = {
      ...findings()[0],
      file: 'x,foo=bar\n::error::',
      name: '<img>`\n::error::%',
    };
    expect(annotation(hostile)).toContain('x%2Cfoo=bar%0A');
    expect(annotation(hostile)).not.toContain('\n');
    expect(summary([hostile], { added: [hostile], resolved: [] })).toContain(
      '&lt;img&gt;&#96;',
    );
    expect(
      summary([], { added: Array(35).fill(hostile), resolved: [] }),
    ).toContain('5 more new findings');
  });
});

describe('owned cleanup backlog', () => {
  const repo = { owner: 'getlarge', repo: 'themoltnet' };
  const workflowUser = { login: 'github-actions[bot]', type: 'Bot' };
  const client = (issues: unknown[] = []) => ({
    paginate: vi.fn().mockResolvedValue(issues),
    rest: {
      issues: { listForRepo: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
  });

  it('creates one assigned issue and no empty issue', async () => {
    const github = client();
    await publishBacklog(github, repo, [], '');
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    await publishBacklog(github, repo, findings(), '');
    expect(github.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assignees: ['getlarge'],
        title: 'Knip cleanup backlog',
      }),
    );
  });

  it('does not notify for line changes or a new run URL', async () => {
    const github = client([
      {
        number: 1,
        user: workflowUser,
        body: backlog(findings(), 'https://old').body,
      },
    ]);
    await publishBacklog(github, repo, findings(99), 'https://new');
    expect(github.rest.issues.update).not.toHaveBeenCalled();
  });

  it('rejects a missing end marker without modifying the issue', async () => {
    const github = client([
      {
        number: 1,
        user: workflowUser,
        body: `Human notes\n${backlogMarker}\nMore notes`,
      },
    ]);

    await expect(publishBacklog(github, repo, findings(), '')).rejects.toThrow(
      'Knip backlog end marker missing; preserve the issue for manual repair',
    );
    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(github.rest.issues.create).not.toHaveBeenCalled();
  });

  it('preserves manual notes, closes an empty backlog, and reopens new debt', async () => {
    const github = client([
      {
        number: 1,
        user: workflowUser,
        body: `Human notes\n${backlog(findings()).body}\nMore notes`,
      },
    ]);
    await publishBacklog(github, repo, [], '');
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'closed',
        body: expect.stringMatching(/^Human notes[\s\S]*More notes$/),
      }),
    );
    const closed = client([
      {
        number: 1,
        user: workflowUser,
        state: 'closed',
        body: backlog([]).body,
      },
    ]);
    await publishBacklog(closed, repo, findings(), '');
    expect(closed.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'open' }),
    );
  });

  it.each([
    { label: 'external user', user: { login: 'visitor', type: 'User' } },
    {
      label: 'contributor',
      user: { login: 'contributor', type: 'User' },
      author_association: 'CONTRIBUTOR',
    },
    { label: 'another bot', user: { login: 'other[bot]', type: 'Bot' } },
    { label: 'missing author', user: null },
    { label: 'pull request', user: workflowUser, pull_request: {} },
  ])(
    'skips a marker from $label and updates the workflow issue',
    async (candidate) => {
      const github = client([
        // A matching fingerprint on an unrelated issue must not suppress updates.
        { number: 99, body: backlog(findings()).body, ...candidate },
        { number: 1, user: workflowUser, body: backlog([]).body },
      ]);

      await publishBacklog(github, repo, findings(), '');

      expect(github.paginate).toHaveBeenCalledWith(
        github.rest.issues.listForRepo,
        expect.objectContaining({ creator: workflowUser.login, state: 'all' }),
      );
      expect(github.rest.issues.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ issue_number: 1 }),
      );
      expect(github.rest.issues.create).not.toHaveBeenCalled();
    },
  );

  it('creates its own issue when only another author has the marker', async () => {
    const github = client([
      {
        number: 99,
        user: { login: 'other[bot]', type: 'Bot' },
        body: backlogMarker,
      },
    ]);

    await publishBacklog(github, repo, findings(), '');

    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(github.rest.issues.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Knip cleanup backlog' }),
    );
  });
});
