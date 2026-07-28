import { describe, expect, it } from 'vitest';

import { checkRepositoryMetadata } from './check-pack.js';

describe('checkRepositoryMetadata', () => {
  it.each([
    'git+https://github.com/getlarge/themoltnet.git',
    'https://github.com/getlarge/themoltnet.git',
  ])('accepts the MoltNet repository URL form %s', (url) => {
    const pkg = {
      repository: {
        type: 'git',
        url,
        directory: 'libs/example',
      },
    };

    const errors = checkRepositoryMetadata(pkg, 'libs/example');

    expect(errors).toEqual([]);
  });

  it('rejects missing repository metadata', () => {
    const errors = checkRepositoryMetadata({}, 'libs/example');

    expect(errors).toEqual([
      'repository metadata missing (npm provenance requires the canonical repository object for libs/example)',
    ]);
  });

  it('rejects provenance URL and monorepo directory mismatches', () => {
    const pkg = {
      repository: {
        type: 'svn',
        url: 'https://github.com/getlarge/another-repo',
        directory: 'libs/elsewhere',
      },
    };

    const errors = checkRepositoryMetadata(pkg, 'libs/example');

    expect(errors).toEqual([
      'repository.type must be "git"',
      'repository.url must identify https://github.com/getlarge/themoltnet',
      'repository.directory must be "libs/example" (got "libs/elsewhere")',
    ]);
  });
});
