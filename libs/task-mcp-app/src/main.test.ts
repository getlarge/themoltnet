import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `main.ts` is a side-effecting entry script: it wires up DOM element
 * references (`byId(...)`) and constructs the `App` bridge client at
 * module scope, then immediately calls `app.connect()`. To exercise
 * `applyOpenState`/`buildTaskListArguments` under different DOM and mock
 * states, each test needs a *fresh* module instance built against a DOM
 * that already has the fixture markup present — the top-level `byId(...)`
 * lookups run once, at import time. That's the documented exception to
 * the "no dynamic imports in tests" rule (see CLAUDE.md): we call
 * `vi.resetModules()` and dynamically `import('./main.js')` per test,
 * after `document.body.innerHTML` is set and after mocking
 * `@modelcontextprotocol/ext-apps` and `./host-context.js`.
 */

const callServerTool = vi.fn();
const connect = vi.fn();
const getHostContext = vi.fn();

vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: vi.fn().mockImplementation(() => ({
    connect,
    callServerTool,
    getHostContext,
    openLink: vi.fn(),
    onhostcontextchanged: undefined,
    ontoolinput: undefined,
    ontoolresult: undefined,
  })),
}));

vi.mock('./host-context.js', () => ({
  syncHostContext: vi.fn(),
}));

const TEAM_ID = '220e8400-e29b-41d4-a716-446655440091';
const PROJECT_ID = '99999999-9999-4999-8999-999999999999';

// Minimal fixture covering every id `main.ts` looks up via `byId(...)`.
const FIXTURE_HTML = `
  <span id="connection"></span>
  <select id="team-select"></select>
  <input id="team-id" />
  <select id="agent"><option value="">Any agent</option></select>
  <select id="status"></select>
  <input id="task-type" />
  <input id="diary-id" />
  <input id="project-id" />
  <input id="correlation-id" />
  <input id="requested-agent-id" />
  <input id="requested-human-id" />
  <select id="has-attempts">
    <option value="">Either</option>
  </select>
  <input id="queued-after" />
  <input id="queued-before" />
  <input id="completed-after" />
  <input id="completed-before" />
  <details id="advanced-filters"></details>
  <div id="queue"></div>
  <span id="queue-count"></span>
  <button id="load-more" hidden></button>
  <span id="selected-status" hidden></span>
  <div id="task-detail"></div>
  <div id="attempts"></div>
  <button id="open-console" hidden></button>
  <form id="filters"></form>
`;

describe('task app main', () => {
  beforeEach(() => {
    vi.resetModules();
    callServerTool.mockReset();
    connect.mockReset().mockResolvedValue(undefined);
    getHostContext.mockReset().mockReturnValue(undefined);
    callServerTool.mockResolvedValue({
      structuredContent: { items: [], nextCursor: undefined },
    });
    document.body.innerHTML = FIXTURE_HTML;
  });

  async function getTasksListArguments(): Promise<Record<string, unknown>> {
    await vi.waitFor(() => {
      const called = callServerTool.mock.calls.some(
        ([args]) => (args as { name: string }).name === 'tasks_list',
      );
      expect(called).toBe(true);
    });
    const call = callServerTool.mock.calls.find(
      ([args]) => (args as { name: string }).name === 'tasks_list',
    );
    const request = call?.[0] as { arguments: Record<string, unknown> };
    return request.arguments;
  }

  it('forwards a project_id UUID from open-state filters into the tasks_list call', async () => {
    const mainModule = await import('./main.js');

    mainModule.applyOpenState({
      team_id: TEAM_ID,
      filters: { project_id: PROJECT_ID },
    });

    const args = await getTasksListArguments();
    expect(args.project_id).toBe(PROJECT_ID);
  });

  it('forwards project_id "none" from open-state filters into the tasks_list call', async () => {
    const mainModule = await import('./main.js');

    mainModule.applyOpenState({
      team_id: TEAM_ID,
      filters: { project_id: 'none' },
    });

    const args = await getTasksListArguments();
    expect(args.project_id).toBe('none');
  });

  it('omits project_id from the tasks_list call when open-state filters have none', async () => {
    const mainModule = await import('./main.js');

    mainModule.applyOpenState({ team_id: TEAM_ID });

    const args = await getTasksListArguments();
    expect(args.project_id).toBeUndefined();
  });

  it('buildTaskListArguments forwards project_id from state as-is', async () => {
    const mainModule = await import('./main.js');

    mainModule.applyOpenState({
      team_id: TEAM_ID,
      filters: { project_id: 'none' },
    });

    expect(mainModule.buildTaskListArguments(false)).toMatchObject({
      team_id: TEAM_ID,
      project_id: 'none',
    });
  });
});
