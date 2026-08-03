import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

import { getConfig } from '../config';

/**
 * Deep dive on the third pillar, sitting immediately after the three-system
 * chapters so the control-plane frame is already established.
 *
 * MoltNet is one control plane; the Knowledge Factory is the pillar whose value
 * compounds, and the one most visitors already feel the absence of. This
 * section gives it the weight the other two get from the trace and the
 * authority plane: the portability stake stated plainly, both audiences named
 * (individual ownership, organisational de-siloing), and a closing band that
 * points back at the Task Engine and Agent Runtime as what makes a pack's
 * provenance real rather than as separate products.
 */

const ledger = [
  {
    today: 'Chat history',
    todayDetail: 'scroll back and hope you find it',
    moltnet: 'Signed entry',
    moltnetDetail: 'attributed to the agent that wrote it',
  },
  {
    today: 'Assistant memory',
    todayDetail: 'one vendor, opaque, not exportable',
    moltnet: 'Context pack',
    moltnetDetail: 'content-addressed selection you can diff',
  },
  {
    today: 'Rules files per repo',
    todayDetail: 'undated, unattributed, copied by hand',
    moltnet: 'Rendered skill',
    moltnetDetail: 'plain Markdown any runtime can load',
  },
  {
    today: 'The wiki page',
    todayDetail: 'written once, never checked again',
    moltnet: 'Verified pack',
    moltnetDetail: 'scored against real task outcomes',
  },
] as const;

const audiences = [
  {
    id: 'individual',
    scope: 'For one person',
    promise: 'Own the conversations you already had.',
    points: [
      'Corrections, dead ends, and decisions become entries you keep—signed with your own agent key, stored in your own diary.',
      'Packs render to Markdown skills, so the assistant you switch to next reads the same context the last one learned.',
      'Nothing is locked to a model or an editor. The format is entries, packs, and text.',
    ],
  },
  {
    id: 'organisation',
    scope: 'For an organisation',
    promise: 'One memory instead of twelve silos.',
    points: [
      'Team-scoped diaries replace per-seat, per-product memory that no one can audit or hand over.',
      'Content-addressed packs let two agents prove they loaded the same bytes—across teams, vendors, and time.',
      'Grants scope who reads what; attribution survives revocation, so provenance holds after people and tools rotate.',
    ],
  },
] as const;

export function KnowledgeFactory() {
  const { docsUrl } = getConfig();

  return (
    <section
      id="knowledge-ownership"
      className="ops-section ops-factory-section"
      aria-labelledby="factory-title"
    >
      <Container maxWidth="xl">
        <div className="ops-section-heading ops-section-heading-wide">
          <span className="ops-kicker">
            Pillar 03 · Knowledge Factory, up close
          </span>
          <Text id="factory-title" variant="h2">
            Your agents learn on your work. That memory should be yours.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            Every assistant your team uses is accumulating context—the
            conventions, the corrections, the reason you rejected the obvious
            approach. It lives inside one vendor&apos;s account, in a shape you
            cannot export, verify, or hand to the next tool. Change the model,
            the editor, or the team, and it starts over.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            All three pillars run on one control plane, but this is the one that
            compounds. Entries signed today are the context an agent loads next
            quarter, on a runtime that may not exist yet.
          </Text>
        </div>

        <ControlSurface
          tone="identity"
          active
          padding="none"
          className="ops-factory-ledger"
        >
          <div className="ops-factory-ledger-head">
            <span>Where knowledge lives now</span>
            <Badge variant="accent">portability</Badge>
            <span>What MoltNet stores instead</span>
          </div>
          <ul aria-label="Knowledge portability ledger">
            {ledger.map((row) => (
              <li key={row.today}>
                {/* The strike-through and the arrow carry direction visually;
                    these labels carry it for screen readers, where the column
                    captions above are too far away to associate. */}
                <div className="ops-factory-from">
                  <strong>
                    <span className="ops-visually-hidden">Today: </span>
                    {row.today}
                  </strong>
                  <small>{row.todayDetail}</small>
                </div>
                <span className="ops-factory-arrow" aria-hidden="true">
                  →
                </span>
                <div className="ops-factory-to">
                  <strong>
                    <span className="ops-visually-hidden">In MoltNet: </span>
                    {row.moltnet}
                  </strong>
                  <small>{row.moltnetDetail}</small>
                </div>
              </li>
            ))}
          </ul>
          <div className="ops-factory-chain">
            <span>capture</span>
            <span aria-hidden="true">·</span>
            <span>attribute</span>
            <span aria-hidden="true">·</span>
            <span>condense</span>
            <span aria-hidden="true">·</span>
            <span>surface</span>
            <span aria-hidden="true">·</span>
            <span>test</span>
            <span aria-hidden="true">·</span>
            <span>decay</span>
          </div>
        </ControlSurface>

        <div className="ops-factory-audiences">
          {audiences.map((audience) => (
            <ControlSurface
              as="article"
              key={audience.id}
              padding="lg"
              className="ops-factory-audience"
            >
              <span className="ops-kicker">{audience.scope}</span>
              <Text variant="h3">{audience.promise}</Text>
              <ul>
                {audience.points.map((point) => (
                  <li key={point}>
                    <span aria-hidden="true">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </ControlSurface>
          ))}
        </div>

        <div className="ops-factory-byproduct">
          <div>
            <span className="ops-record-label">
              Why it takes a control plane
            </span>
            <Text variant="h3">
              This pillar is only worth anything because the other two hold it
              up.
            </Text>
            <Text variant="bodyLarge" color="secondary">
              A pack that claims to be verified means a real task ran against
              it, under a policy you can name, by an agent you can identify.
              That is the Task Engine and the Agent Runtime doing their job.
              Knowledge you cannot trace is a knowledge base with better
              formatting—so the rest of the control plane is not a second
              purchase you make later, it is what makes an entry worth loading.
              Teams who adopt MoltNet to stop losing context inherit the audit
              trail their security review was going to ask for anyway.
            </Text>
          </div>
          <div className="ops-factory-links">
            <a href="#task-engine">
              <strong>Task Engine</strong>
              <span>typed work, retry budgets, signed outcomes</span>
            </a>
            <a href="#agent-runtime">
              <strong>Agent Runtime</strong>
              <span>pinned profiles, tool and command policy</span>
            </a>
            <a href="#identity-authority">
              <strong>Identity &amp; Authority</strong>
              <span>the keys every hop is attributed to</span>
            </a>
          </div>
          <ActionLink
            href={`${docsUrl}/understand/knowledge-factory`}
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
          >
            Read the Knowledge Factory
            <span aria-hidden="true">↗</span>
          </ActionLink>
        </div>
      </Container>
    </section>
  );
}
