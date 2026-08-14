# PackLineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an embedded, authenticated pack-lineage panel on a new console `PackDetailPage`, and delete the landing page's `/labs/provenance` lab.

**Architecture:** Pure lineage logic (`packs/lineage.ts`) extracts the _spine_ — packs and rendered packs joined by `supersedes` / `rendered_from` — from the `ProvenanceGraph` that `usePackProvenance` already returns, discarding entry nodes (those belong to `PackComposition`). A form selector picks a vertical chain for linear lineage and a vertical graph when the DAG branches. Each spine node carries `DecayBadge` and, for context packs, `PinControl`.

**Tech Stack:** React 19, wouter, TanStack Query, `@themoltnet/design-system`, TypeBox-typed `@moltnet/models`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-14-pack-lineage-design.md`

## Global Constraints

- React + `@themoltnet/design-system` only. **No charting or graph library.**
- Dark and light themes both. WCAG AA is binding (`docs/contribute/accessibility.md`).
- **No `paths` aliases** in any tsconfig. Source-direct workspace exports.
- **No server changes.** The provenance wire format, `buildPackProvenanceGraph`, and `libs/models/src/provenance-graph.ts` are untouched.
- Lifecycle state renders through `DecayBadge` — never a second visual language for pinned/expiring.
- Amber (`accent`) is reserved for cryptographic identity (`docs/contribute/design-system.md:170`). Do not use it for lifecycle.
- Fingerprints always render mono via `KeyFingerprint` (`design-system.md:169`).
- **No dynamic `await import()` in tests.** Static imports only.
- Rendered-pack nodes are **read-only** this phase — `usePinRenderedPack` stays uncalled (spec decision 1).

---

### Task 1: Register `/packs/:id` with a minimal PackDetailPage

Closes the dead-link blocker from PR #1883: `PackCard` takes an optional `onOpen` that nothing supplies because no route exists.

**Files:**

- Create: `apps/console/src/pages/PackDetailPage.tsx`
- Modify: `apps/console/src/App.tsx` (add route beside `/packs`)
- Modify: `apps/console/src/pages/PacksPage.tsx` (pass `onOpen` to `PackCard`)
- Test: `apps/console/__tests__/pack-detail-page.test.tsx`

**Interfaces:**

- Consumes: `usePack(packId)` from `apps/console/src/packs/hooks.ts`
- Produces: `PackDetailPage` (default-exported named function), route `/packs/:id`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PackDetailPage } from '../src/pages/PackDetailPage.js';

const mocks = vi.hoisted(() => ({ pack: {} as Record<string, unknown> }));
vi.mock('../src/packs/hooks.js', () => ({
  usePack: () => mocks.pack,
  usePackProvenance: () => ({
    isLoading: false,
    isError: false,
    data: undefined,
  }),
}));
vi.mock('wouter', () => ({
  useParams: () => ({ id: 'pack-1' }),
  useLocation: () => ['', vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('PackDetailPage', () => {
  it('renders the pack heading once loaded', () => {
    mocks.pack = {
      isLoading: false,
      isError: false,
      data: {
        id: 'pack-1',
        packType: 'compile',
        params: { prompt: 'How does auth work?' },
        pinned: false,
        expiresAt: null,
        createdAt: '2026-08-01T00:00:00Z',
        packCid: 'bafy...',
        creator: { kind: 'agent', fingerprint: 'AAAA-BBBB' },
      },
    };
    render(<PackDetailPage />);
    expect(
      screen.getByRole('heading', { name: /How does auth work\?/ }),
    ).toBeInTheDocument();
  });

  it('surfaces the API problem detail on error', () => {
    mocks.pack = {
      isLoading: false,
      isError: true,
      error: { detail: 'Forbidden for this team' },
      data: undefined,
    };
    render(<PackDetailPage />);
    expect(screen.getByText('Forbidden for this team')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nx run @moltnet/console:test -- __tests__/pack-detail-page.test.tsx`
Expected: FAIL — cannot resolve `../src/pages/PackDetailPage.js`

- [ ] **Step 3: Write minimal implementation**

Create `PackDetailPage.tsx` using the existing page idiom (see `PacksPage.tsx` for the `PageHeader` / `InlineNotice` / `getApiErrorDetail` pattern). Reuse `packSummary` for the heading — **import it from wherever `PackCard` exports it**; do not re-implement the params narrowing. Then in `App.tsx`:

```tsx
<Route path="/packs/:id" component={PackDetailPage} />
```

and in `PacksPage.tsx` pass `onOpen={(packId) => navigate(`/packs/${packId}`)}` to `PackCard`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nx run @moltnet/console:test -- __tests__/pack-detail-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Update the routing guard**

`apps/console/__tests__/knowledge-routing.test.tsx` asserts `/packs/:id` is _absent_. Invert it to assert the route now resolves to `PackDetailPage` rather than `NotFoundPage`. Restore the nav↔route consistency check flagged in the #1883 review.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/pages/PackDetailPage.tsx apps/console/src/App.tsx apps/console/src/pages/PacksPage.tsx apps/console/__tests__/pack-detail-page.test.tsx apps/console/__tests__/knowledge-routing.test.tsx
git commit -m "feat(console): register /packs/:id with pack detail page"
```

---

### Task 2: Pure lineage extraction (`packs/lineage.ts`)

The heart of the redesign: reduce the full provenance graph to its spine and decide which form renders it.

**Files:**

- Create: `apps/console/src/packs/lineage.ts`
- Test: `apps/console/__tests__/pack-lineage.test.ts`

**Interfaces:**

- Consumes: `ProvenanceGraph`, `ProvenanceGraphCreator` from `@moltnet/models`; `countEdges` logic ported from `apps/landing/src/provenance/viewer-utils.ts`
- Produces:

```ts
export interface SpineNode {
  id: string;
  kind: 'pack' | 'rendered_pack';
  label: string;
  cid: string | null;
  pinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  isRoot: boolean;
  entryCount: number;
  creator: ProvenanceGraphCreator | null;
  packId?: string;
  renderedPackId?: string;
}
export type LineageForm = 'none' | 'linear';
export interface Lineage {
  form: LineageForm;
  spine: SpineNode[];
  renderedByPackId: Record<string, SpineNode[]>;
}
export function buildLineage(graph: ProvenanceGraph): Lineage;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildLineage } from '../src/packs/lineage.js';
import {
  graphFixture,
  packNode,
  entryNode,
  edge,
} from './fixtures/provenance.js';

describe('buildLineage', () => {
  it('reports form "none" for a root pack with no supersession and no renders', () => {
    const graph = graphFixture({ nodes: [packNode('p1')], edges: [] });
    expect(buildLineage(graph).form).toBe('none');
  });

  it('drops entry nodes from the spine', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), entryNode('e1'), entryNode('e2')],
      edges: [edge('p1', 'e1', 'includes'), edge('p1', 'e2', 'includes')],
    });
    const lineage = buildLineage(graph);
    expect(lineage.spine.map((n) => n.id)).toEqual(['p1']);
  });

  it('counts included entries per spine node', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), entryNode('e1'), entryNode('e2')],
      edges: [edge('p1', 'e1', 'includes'), edge('p1', 'e2', 'includes')],
    });
    expect(buildLineage(graph).spine[0]?.entryCount).toBe(2);
  });

  it('orders a linear chain newest first with the root flagged', () => {
    const graph = graphFixture({
      nodes: [packNode('p1'), packNode('p0')],
      edges: [edge('p1', 'p0', 'supersedes')],
    });
    const lineage = buildLineage(graph);
    expect(lineage.form).toBe('linear');
    expect(lineage.spine.map((n) => n.id)).toEqual(['p1', 'p0']);
    expect(lineage.spine[0]?.isRoot).toBe(true);
  });

  it('flags a pack whose recorded ancestor is not in the graph', () => {
    // The server omits packs the caller cannot read and stops at the requested
    // depth, so the chain can continue past what we received.
    const graph = graphFixture({
      nodes: [packNode('p1', { supersedesPackId: 'an-older-pack' })],
      edges: [],
    });
    expect(buildLineage(graph).spine[0]?.hasHiddenAncestor).toBe(true);
  });

  it('groups rendered packs under their source pack without putting them on the spine', () => {
    const graph = graphFixture({
      nodes: [
        packNode('p1'),
        { ...packNode('r1'), kind: 'rendered_pack' as const },
      ],
      edges: [edge('r1', 'p1', 'rendered_from')],
    });
    const lineage = buildLineage(graph);
    expect(lineage.spine.map((n) => n.id)).toEqual(['p1']);
    expect(lineage.renderedByPackId['p1']?.map((n) => n.id)).toEqual(['r1']);
  });
});
```

Create `apps/console/__tests__/fixtures/provenance.ts` with `graphFixture`, `packNode`, `entryNode`, `edge` builders producing valid `moltnet.provenance-graph/v1` shapes — mirror the real field set in `libs/models/src/provenance-graph.ts`, not an invented one. (The #1883 review found a test fixture encoding a shape no producer writes; do not repeat that.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx run @moltnet/console:test -- __tests__/pack-lineage.test.ts`
Expected: FAIL — `buildLineage` is not defined

- [ ] **Step 3: Implement `buildLineage`**

Walk `supersedes` edges from `graph.metadata.rootNodeId` breadth-first; collect pack nodes in encounter order (newest first, root at index 0). Attach `rendered_pack` nodes to `renderedByPackId` keyed by the **`from`** end of their `rendered_from` edge — the producer emits `from` = source pack, `to` = rendered pack. Count `includes` edges per pack for `entryCount`. Set `form`:

- `none` when the spine has one node and no rendered packs,
- `linear` otherwise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx run @moltnet/console:test -- __tests__/pack-lineage.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/packs/lineage.ts apps/console/__tests__/pack-lineage.test.ts apps/console/__tests__/fixtures/provenance.ts
git commit -m "feat(console): extract pack lineage spine from provenance graph"
```

---

### Task 3: `LineageChain` — the linear form

**Files:**

- Create: `apps/console/src/components/packs/LineageChain.tsx`
- Test: `apps/console/__tests__/lineage-chain.test.tsx`

**Interfaces:**

- Consumes: `Lineage`, `SpineNode` (Task 2); `DecayBadge`, `PinControl` (existing); `describeDecay`, `isExpiringSoon` from `packs/decay.ts`
- Produces: `LineageChain({ lineage, now, onOpen }: { lineage: Lineage; now: Date; onOpen: (node: SpineNode) => void })`

Render an ordered list (`<ol>` semantics — the lineage must be readable as structure, not only as a picture) newest-first. Each item: label, `DecayBadge` from `describeDecay({ pinned, expiresAt }, now)`, entry count, creator via `KeyFingerprint`, and — for `kind === 'pack'` only — `PinControl`. Rendered packs nest under their source pack, read-only.

Per spec decision 2, use `isExpiringSoon` to distinguish "expiring soon" from "expires eventually" in the chain — this is the consumer that threshold has been missing.

- [ ] **Step 1: Write failing tests** covering: newest-first order; `DecayBadge` present per node; `PinControl` rendered for packs and **absent** for rendered packs; list semantics exposed (`getAllByRole('listitem')`); root node marked as current.
- [ ] **Step 2: Run tests, verify they fail.** Run: `pnpm exec nx run @moltnet/console:test -- __tests__/lineage-chain.test.tsx`
- [ ] **Step 3: Implement** using `Stack`, `Card`, `Text`, `Badge`, `KeyFingerprint` from the design system. **Load `.claude/skills/impeccable/reference/craft-floor.md` before writing this component.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit** — `feat(console): add linear lineage chain component`

---

### Task 5: `PackLineage` panel — states and adaptive form

**Files:**

- Create: `apps/console/src/components/packs/PackLineage.tsx`
- Test: `apps/console/__tests__/pack-lineage-panel.test.tsx`

**Interfaces:**

- Consumes: `usePackProvenance(packId)`, `buildLineage`, `LineageChain`
- Produces: `PackLineage({ packId, now }: { packId: string; now: Date })`

Every material state from the spec:

| State            | Render                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| loading          | skeleton preserving row geometry — not a bare text node; give it `role="status"`                                                      |
| error            | `InlineNotice` with `getApiErrorDetail` **plus a retry**, matching `AgentKeysPage`'s treatment                                        |
| `form: 'none'`   | "This pack has no lineage yet" — explain that supersession happens when a newer pack replaces this one. Do not render an empty graph. |
| `form: 'linear'` | `LineageChain`                                                                                                                        |
| partial          | ancestor the operator cannot read renders as an explicit gap node, never a silent omission                                            |

- [ ] **Step 1: Write failing tests** for all six rows above. Include one asserting the error branch receives a **plain `{ detail }` object**, not an `Error` instance — the generated client throws the parsed body (the gap the #1883 review found).
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement.** **Load craft-floor.md first.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit** — `feat(console): add pack lineage panel with adaptive form`

---

### Task 6: Wire `PackLineage` into `PackDetailPage`

**Files:**

- Modify: `apps/console/src/pages/PackDetailPage.tsx`
- Modify: `apps/console/__tests__/pack-detail-page.test.tsx`

- [ ] **Step 1: Write a failing test** asserting the detail page renders the lineage panel for its pack id, with a single `now` created once per render and passed down (the frozen-`now` issue flagged on `PacksPage`: create it per render, not per component).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Commit** — `feat(console): show lineage on pack detail page`

---

### Task 7: Delete the landing lab and update documentation

**Files:**

- Delete: `apps/landing/src/pages/ProvenancePage.tsx`, `apps/landing/src/provenance/`, `apps/landing/__tests__/provenance-graph.test.tsx`, `apps/landing/__tests__/fixtures/sample-provenance-graph.ts`
- Modify: `apps/landing/src/App.tsx` (remove the `/labs/provenance` route)
- Modify: `docs/use/context-packs.md:700,708`, `docs/understand/knowledge-factory.md:118`, `docs/reference/quick-reference.md:29`, `.agents/skills/legreffier-explore/SKILL.md:435,440`

Docs must stop telling users to paste a graph into a public viewer that no longer exists. Point `moltnet pack provenance` output at the console pack detail page instead, and state plainly that inspecting a graph now requires console access — do not quietly drop the sentence.

- [ ] **Step 1: Remove the route and delete the files.**
- [ ] **Step 2: Run the landing suite.** Run: `pnpm exec nx run @moltnet/landing:test` — expect green with the provenance tests gone.
- [ ] **Step 3: Update all four doc references.**
- [ ] **Step 4: Grep for stragglers.** Run: `rg -n "labs/provenance" --glob '!node_modules'` — expect no hits outside the CLI's user-supplied `--share-url` example text.
- [ ] **Step 5: Commit** — `refactor(landing): remove provenance lab in favor of console lineage`

---

### Task 8: Full verification

- [ ] **Step 1: Run the console and landing suites.**

```bash
pnpm exec nx run-many -t test --projects=@moltnet/console,@moltnet/landing
```

- [ ] **Step 2: Lint and typecheck.**

```bash
pnpm exec nx run-many -t lint typecheck --projects=@moltnet/console,@moltnet/landing
```

- [ ] **Step 3: Bring up infra and the console.**

```bash
docker compose --env-file .env.local up -d
pnpm exec nx run @moltnet/console:dev
```

- [ ] **Step 4: Browser verification.** Drive the console with the Chrome tools. Confirm each state against a real pack: no-lineage, linear chain, and a chain truncated by depth or permission. Check **both themes**, keyboard traversal of the spine, and that pinning from the panel updates the badge without a page reload.
- [ ] **Step 5: Accessibility check.** Verify the `<ol>` structure is exposed, every node is keyboard reachable, focus is visible, and the pin toggle announces its state (`aria-pressed`, per the fix that landed in #1883).
- [ ] **Step 6: Commit any fixes, then open the PR.**

---

## Self-Review

**Spec coverage.** Job/audience → Tasks 5–6. Adaptive form → Tasks 2–5. Spine/membership split → Task 2 (entries dropped). Decay-horizon focal moment → Task 3 (`isExpiringSoon`, spec decision 2). Rendered packs read-only → Tasks 2–3 (spec decision 1). Per-node pin scope → Task 3 (spec decision 3). All six material states → Task 5. Move + doc updates → Task 7. Accessibility → Tasks 3, 4, 8.

**Gap, stated rather than hidden:** the spec covers `PackLineage` and only the touch points of `PackComposition`. This plan therefore does **not** build `PackComposition`; the entry list needs its own design pass. Issue #654 does not fully close until it exists.

**Placeholders:** none. Every step names its command and expected result.

**Type consistency:** `SpineNode`, `LineageForm`, `Lineage`, `buildLineage`, `buildLineageLayout` are used with identical names and shapes across Tasks 2–6.
