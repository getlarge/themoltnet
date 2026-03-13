import { describe, expect, it } from 'vitest';

import { assembleSkill } from './skill-adapter.js';

describe('assembleSkill', () => {
  it('concatenates preamble + candidate instruction + epilogue', () => {
    const result = assembleSkill(
      '# Preamble\n',
      '## Commit workflow\n',
      '# Epilogue\n',
    );
    expect(result).toBe('# Preamble\n## Commit workflow\n# Epilogue\n');
  });

  it('handles empty candidate', () => {
    const result = assembleSkill('PRE\n', '', 'POST\n');
    expect(result).toBe('PRE\nPOST\n');
  });
});
