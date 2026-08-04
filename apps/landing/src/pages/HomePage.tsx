import { useTheme } from '@themoltnet/design-system';

import { AuthorityPlane } from '../components/AuthorityPlane';
import { Collaboration } from '../components/Collaboration';
import { ExecutionTrace } from '../components/ExecutionTrace';
import { GetStarted } from '../components/GetStarted';
import { Hero } from '../components/Hero';
import { KnowledgeFactory } from '../components/KnowledgeFactory';
import { OpenSource } from '../components/OpenSource';
import { Systems } from '../components/Systems';

/**
 * THESIS: MoltNet is the agent operations control plane, not a generic agent
 * framework; it connects typed work, bounded execution, and durable knowledge.
 *
 * OWN-WORLD: Matte graphite control surfaces, exact rule lines, network teal
 * for work in motion, and identity amber for authority and signatures.
 *
 * STORY: See the three systems, follow one task through them, then go deeper on
 * the pillar whose value compounds—knowledge you own rather than knowledge
 * stranded in a vendor's memory—before inspecting the authority boundary and
 * real Console, and starting a supervised team pilot.
 *
 * FIRST VIEWPORT: A concise claim and two actions sit beside a large three-part
 * system map seated on an Identity & Authority foundation.
 *
 * FORM: Agent Operations Control Plane; architectural staging selected from
 * the approved hybrid composition; concept seed 77c53d75.
 */
export function HomePage() {
  const theme = useTheme();
  const cssVariables = {
    '--ops-void': theme.color.bg.void,
    '--ops-surface': theme.color.bg.surface,
    '--ops-elevated': theme.color.bg.elevated,
    '--ops-overlay': theme.color.bg.overlay,
    '--ops-border': theme.color.border.DEFAULT,
    '--ops-border-hover': theme.color.border.hover,
    '--ops-text': theme.color.text.DEFAULT,
    '--ops-text-secondary': theme.color.text.secondary,
    '--ops-text-muted': theme.color.text.muted,
    '--ops-network': theme.color.primary.DEFAULT,
    '--ops-network-muted': theme.color.primary.muted,
    '--ops-identity': theme.color.accent.DEFAULT,
    '--ops-identity-muted': theme.color.accent.muted,
    '--ops-success': theme.color.success.DEFAULT,
    '--ops-error': theme.color.error.DEFAULT,
    '--ops-font-mono': theme.font.family.mono,
  } as React.CSSProperties;

  return (
    <div className="ops-home" style={cssVariables}>
      <Hero />
      <ExecutionTrace />
      <Systems />
      <KnowledgeFactory />
      <AuthorityPlane />
      <Collaboration />
      <OpenSource />
      <GetStarted />
    </div>
  );
}
