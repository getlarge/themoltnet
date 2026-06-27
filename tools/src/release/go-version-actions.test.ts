import { describe, expect, it } from 'vitest';

import {
  findGoRequireVersion,
  updateGoRequireVersions,
} from './go-version-actions';

describe('go version actions helpers', () => {
  it('reads versions from single-line and block require declarations', () => {
    const goMod = `module github.com/getlarge/themoltnet/apps/moltnet-cli

go 1.24

require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0

require (
	github.com/getlarge/themoltnet/libs/dspy-adapters v0.3.0
	github.com/other/module v1.0.0
)
`;

    expect(
      findGoRequireVersion(
        goMod,
        'github.com/getlarge/themoltnet/libs/moltnet-api-client',
      ),
    ).toBe('v0.2.0');
    expect(
      findGoRequireVersion(
        goMod,
        'github.com/getlarge/themoltnet/libs/dspy-adapters',
      ),
    ).toBe('v0.3.0');
  });

  it('updates only matching require entries and preserves comments', () => {
    const goMod = `module github.com/getlarge/themoltnet/apps/moltnet-cli

go 1.24

require (
	github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0 // direct
	github.com/other/module v1.0.0
)

replace github.com/getlarge/themoltnet/libs/moltnet-api-client => ../../libs/moltnet-api-client
`;

    const result = updateGoRequireVersions(goMod, {
      'github.com/getlarge/themoltnet/libs/moltnet-api-client': '0.3.0',
      'github.com/getlarge/themoltnet/libs/missing': '0.4.0',
    });

    expect(result.updatedModules).toEqual([
      'github.com/getlarge/themoltnet/libs/moltnet-api-client@v0.3.0',
    ]);
    expect(result.goMod).toContain(
      'github.com/getlarge/themoltnet/libs/moltnet-api-client v0.3.0 // direct',
    );
    expect(result.goMod).toContain('github.com/other/module v1.0.0');
    expect(result.goMod).toContain(
      'replace github.com/getlarge/themoltnet/libs/moltnet-api-client => ../../libs/moltnet-api-client',
    );
    expect(result.goMod).not.toContain(
      'github.com/getlarge/themoltnet/libs/missing',
    );
  });

  it('normalizes dependency versions to Go module v-prefixed semver', () => {
    const result = updateGoRequireVersions(
      'require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.2.0\n',
      {
        'github.com/getlarge/themoltnet/libs/moltnet-api-client': 'v0.3.0',
      },
    );

    expect(result.goMod).toBe(
      'require github.com/getlarge/themoltnet/libs/moltnet-api-client v0.3.0\n',
    );
  });
});
