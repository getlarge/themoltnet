---
name: MoltNet
description: Agent operations control plane
colors:
  void: '#08080d'
  surface: '#0f0f17'
  elevated: '#171721'
  overlay: '#1f1f2e'
  network: '#00d4c8'
  network-hover: '#00f0e2'
  identity: '#e6a817'
  identity-hover: '#f0b829'
  text: '#e8e8f0'
  text-secondary: '#8888a0'
  text-muted: '#7d7d96'
  text-inverse: '#08080d'
  border: '#252535'
  border-hover: '#353548'
  error: '#f04060'
  success: '#40c060'
typography:
  display:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: 'clamp(3rem, 7vw, 5.75rem)'
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: '-0.035em'
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: 'JetBrains Mono, Fira Code, SF Mono, Menlo, Consolas, monospace'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: '4px'
  md: '8px'
  lg: '12px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '48px'
components:
  action-primary:
    backgroundColor: '{colors.network}'
    textColor: '{colors.text-inverse}'
    rounded: '{rounded.md}'
    padding: '12px 20px'
  action-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '12px 20px'
  control-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
    padding: '24px'
---

# Design System: MoltNet

## Overview

**Creative North Star: “The Agent Operations Control Plane.”**

MoltNet should feel like infrastructure a platform team can inspect and operate,
not a speculative AI landing page. Its signature composition is a connected
system trace: typed work enters, bounded execution occurs, and attributable
knowledge survives. The interface borrows the density and precision of control
planes, policy consoles, and build systems while keeping the hierarchy calm.

The system refuses generic feature-card walls, neon “AI” scenery, invented
social proof, and decorative diagrams. Every visible node, status, command, and
connection must explain a real MoltNet capability.

**Key characteristics:**

- One large operational model before supporting feature detail.
- Matte, structured surfaces separated by rules and tonal depth.
- Teal carries coordination and action; amber carries identity and signatures.
- Real product evidence, data, and source links replace marketing ornament.

## Colors

The palette is dark-first because operators inspect agent work in developer and
operations environments where code, logs, policies, and traces share the screen.

- **Void** (`#08080d`): page field and deepest backdrop.
- **Control Surface** (`#0f0f17`): diagrams, evidence panes, and operator UI.
- **Elevated Surface** (`#171721`): selected or active regions.
- **Network Teal** (`#00d4c8`): links, active flow, coordination, and primary
  actions.
- **Identity Amber** (`#e6a817`): agent keys, task credentials, signatures, and
  immutable evidence only.
- **Signal colors** communicate actual states. They are never decorative.

**The Two-Layer Rule.** Teal explains where work moves. Amber explains who or
what authorizes and attests it.

## Typography

Inter remains the workhorse face because the Console and landing must share an
operational vocabulary. Display typography earns distinction through scale,
tight composition, and decisive line breaks rather than a separate novelty
face. JetBrains Mono is reserved for task types, policy fields, fingerprints,
hashes, commands, and state.

- **Display:** semibold, tightly tracked, at most two clauses.
- **Section headline:** strong sentence case with a restrained measure.
- **Body:** 65–75 characters per line, plain language, no inflated claims.
- **Data:** compact mono labels and values; never use mono as a generic tech
  costume.

## Layout

The primary layout is a twelve-column control-plane grid. Marketing copy uses
four or five columns; the system demonstration owns the remaining space.
Sections alternate between dense operational evidence and quiet explanation.
Wide rules and aligned baselines connect sections into one system rather than a
stack of unrelated cards.

On narrow screens, topology becomes a vertical execution trace in the same
causal order. No core capability disappears. Touch targets remain at least
44px, diagrams retain readable labels, and dense evidence gains horizontal
overflow only when its tabular structure requires it.

## Elevation & Depth

Depth comes from tonal layering, inset rules, and selective offset shadows.
Control surfaces are flat at rest. Teal and amber glows are rare semantic
signals around an active route or verified identity—not ambient decoration.

## Shapes

Corners are restrained: 8–12px for control surfaces, 8px for actions, and 4px
for data labels. Pills are limited to compact status values. Nodes and evidence
panes align to a shared grid and use one-pixel borders; organic blobs and loose
floating cards do not belong to this system.

## Components

### Navigation

Compact, stable, and source-oriented. Product anchors name the three systems.
Documentation and GitHub remain visible. One filled action leads to the team
pilot; all other actions are text or outlined.

### System Diagram

The signature component. It shows Task Engine, Agent Runtime, and Knowledge
Factory as connected operating systems above a persistent Identity & Authority
plane. Active routes use teal. Identity, credentials, policy snapshots, and
attestations use amber. Denied or constrained paths include text and symbols,
never color alone.

### Evidence Panes

Evidence panes resemble inspectable operator output: explicit title, state,
source, and payload. They may contain real Console screenshots, task envelopes,
policy snapshots, execution events, or signed records. Synthetic examples are
labelled.

### Actions

Primary actions use Network Teal with inverse text. Secondary actions use a
surface fill and one-pixel rule. Every action has visible hover and dual-ring
focus treatment from the design system.

## Do's and Don'ts

### Do:

- **Do** make every major claim inspectable through a diagram, payload, product
  screenshot, documentation link, or source link.
- **Do** show how authentication and authorization strengthen all three systems.
- **Do** vary section density while preserving one continuous execution story.
- **Do** expose open-source installation and architecture early.

### Don't:

- **Don't** present Task Engine, Agent Runtime, or Knowledge Factory as three
  interchangeable feature cards.
- **Don't** claim customers, benchmarks, scale, or outcomes without evidence.
- **Don't** use amber as a generic accent or teal as ambient neon.
- **Don't** hide the product behind mascots, abstract agent imagery, or generic
  dashboard mockups.
