import type { ReactNode } from 'react';

import { useTheme } from '../hooks.js';
import type { Signal } from '../types.js';
import { Badge, type BadgeVariant } from './badge.js';
import { ControlSurface, type ControlSurfaceTone } from './control-surface.js';
import {
  DescriptionList,
  type DescriptionListItem,
} from './description-list.js';
import { Stack } from './stack.js';
import { Text } from './text.js';

export interface RecordTraceStep {
  id: string;
  label: ReactNode;
  context?: ReactNode;
  status: ReactNode;
  statusTone?: 'default' | 'network' | 'identity' | Signal;
  tone?: ControlSurfaceTone;
  active?: boolean;
  details?: DescriptionListItem[];
  action?: ReactNode;
}

export interface RecordTraceProps {
  steps: RecordTraceStep[];
  ariaLabel: string;
}

export function RecordTrace({ steps, ariaLabel }: RecordTraceProps) {
  const theme = useTheme();

  return (
    <ol
      aria-label={ariaLabel}
      style={{
        display: 'grid',
        gap: theme.spacing[3],
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))',
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {steps.map((step, index) => (
        <li key={step.id} style={{ minWidth: 0, position: 'relative' }}>
          <ControlSurface
            as="article"
            tone={step.tone}
            active={step.active}
            padding="sm"
            style={{ height: '100%' }}
          >
            <Stack gap={3}>
              <Stack
                direction="row"
                justify="space-between"
                align="flex-start"
                gap={2}
              >
                <Stack gap={1} style={{ minWidth: 0 }}>
                  <Text variant="caption" color="muted" mono>
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <Text variant="h4">{step.label}</Text>
                  {step.context ? (
                    <Text variant="caption" color="secondary">
                      {step.context}
                    </Text>
                  ) : null}
                </Stack>
                <Badge variant={badgeVariant(step.statusTone)}>
                  {step.status}
                </Badge>
              </Stack>
              {step.details?.length ? (
                <DescriptionList items={step.details} columns={1} compact />
              ) : null}
              {step.action}
            </Stack>
          </ControlSurface>
        </li>
      ))}
    </ol>
  );
}

function badgeVariant(tone: RecordTraceStep['statusTone']): BadgeVariant {
  if (tone === 'network') return 'primary';
  if (tone === 'identity') return 'accent';
  return tone ?? 'default';
}
