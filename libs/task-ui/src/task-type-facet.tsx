import { useMemo } from 'react';

import { MultiSelectFacet } from './analytics/multi-select-facet.js';
import { humanizeToken } from './format.js';

export interface TaskTypeFacetProps {
  /** Registered task-type names (resolved by the app, e.g. via listTaskSchemas). */
  availableTypes: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Trigger label. Defaults to "Type". */
  label?: string;
}

/**
 * Task-type multi-select facet — a thin wrapper over the generic
 * `MultiSelectFacet` that maps raw task-type tokens to humanized option labels
 * and keeps the "Task type" heading. The popup + a11y behaviour lives in
 * `MultiSelectFacet` so the two facets can't drift.
 */
export function TaskTypeFacet({
  availableTypes,
  selected,
  onChange,
  label = 'Type',
}: TaskTypeFacetProps) {
  const options = useMemo(
    () =>
      availableTypes.map((type) => ({
        value: type,
        label: humanizeToken(type),
      })),
    [availableTypes],
  );

  return (
    <MultiSelectFacet
      label={label}
      heading="Task type"
      options={options}
      selected={selected}
      onChange={onChange}
    />
  );
}
