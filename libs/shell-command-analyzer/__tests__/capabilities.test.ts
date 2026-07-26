import { describe, expect, it } from 'vitest';

import {
  ARBITRARY_CODE_BINARIES,
  classifyRisk,
  FIND_EXEC_FLAGS,
  gtfobinsFunctions,
  WRAPPERS,
} from '../src/capabilities.js';
import { GTFOBINS, GTFOBINS_SOURCE_COMMIT } from '../src/gtfobins.generated.js';

describe('classifyRisk', () => {
  describe('arbitrary-code tier', () => {
    for (const name of [
      'sh',
      'bash',
      'zsh',
      'dash',
      'ksh',
      'fish',
      'python',
      'python3',
      'perl',
      'ruby',
      'node',
      'deno',
      'bun',
      'php',
      'lua',
      'pwsh',
      'powershell',
      'osascript',
    ]) {
      it(`classifies ${name} as arbitrary-code`, () => {
        expect(classifyRisk(name)).toBe('arbitrary-code');
      });
    }

    for (const name of [
      'python3.11',
      'python2.7',
      'php8.2',
      'ruby3.3',
      'node20',
      'perl5',
      'pypy3.10',
    ]) {
      it(`classifies versioned interpreter ${name} as arbitrary-code`, () => {
        expect(classifyRisk(name)).toBe('arbitrary-code');
      });
    }

    it('takes precedence over GTFOBins membership', () => {
      // python/bash/node/perl are in GTFOBins, but the interpreter tier wins.
      for (const name of ['python', 'bash', 'node', 'perl']) {
        expect(name in GTFOBINS).toBe(true);
        expect(classifyRisk(name)).toBe('arbitrary-code');
      }
    });
  });

  describe('escapable tier (GTFOBins-backed)', () => {
    for (const name of [
      'find',
      'vim',
      'awk',
      'sed',
      'tar',
      'less',
      'man',
      'git',
      'docker',
      'gdb',
      'ssh',
      'curl',
      'wget',
      'make',
      'nmap',
      'cp',
      'mv',
      'cat',
    ]) {
      it(`classifies GTFOBins binary ${name} as escapable`, () => {
        expect(name in GTFOBINS).toBe(true);
        expect(classifyRisk(name)).toBe('escapable');
      });
    }

    it('classifies every non-interpreter GTFOBins binary as escapable', () => {
      for (const name of Object.keys(GTFOBINS)) {
        if (ARBITRARY_CODE_BINARIES.has(name)) {
          continue;
        }
        expect(classifyRisk(name)).toBe('escapable');
      }
    });
  });

  describe('benign tier', () => {
    for (const name of [
      'ls',
      'echo',
      'mkdir',
      'pwd',
      'whoami',
      'true',
      'sleep',
      'id',
      'uname',
      'rm',
      'touch',
      'printf',
    ]) {
      it(`classifies ${name} as benign`, () => {
        expect(name in GTFOBINS).toBe(false);
        expect(classifyRisk(name)).toBe('benign');
      });
    }

    it('does not misclassify a name that merely starts like an interpreter', () => {
      expect(classifyRisk('pythonic')).toBe('benign');
      expect(classifyRisk('nodemon')).toBe('benign');
      expect(classifyRisk('phpstorm')).toBe('benign');
    });
  });
});

describe('gtfobinsFunctions', () => {
  it('returns the documented abuse functions for a GTFOBins binary', () => {
    expect(gtfobinsFunctions('find')).toContain('shell');
    expect(gtfobinsFunctions('find')).toContain('file-write');
    expect(gtfobinsFunctions('python')).toContain('shell');
  });

  it('returns an empty list for a non-GTFOBins binary', () => {
    expect(gtfobinsFunctions('ls')).toEqual([]);
    expect(gtfobinsFunctions('definitely-not-a-real-binary')).toEqual([]);
  });
});

describe('vendored GTFOBins dataset', () => {
  it('is pinned to a concrete source commit', () => {
    expect(GTFOBINS_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('covers the full GTFOBins catalogue and every entry has functions', () => {
    const names = Object.keys(GTFOBINS);
    expect(names.length).toBeGreaterThan(400);
    for (const fns of Object.values(GTFOBINS)) {
      expect(fns.length).toBeGreaterThan(0);
    }
  });

  it('resolves alias entries to the target functions', () => {
    // `awk` is a GTFOBins alias of `mawk`; the functions must be carried over.
    expect(gtfobinsFunctions('awk').length).toBeGreaterThan(0);
    expect(gtfobinsFunctions('awk')).toContain('shell');
  });
});

describe('capability tables', () => {
  it('exposes the common command wrappers', () => {
    for (const wrapper of [
      'sudo',
      'env',
      'timeout',
      'nice',
      'xargs',
      'exec',
      'chroot',
      'nohup',
    ]) {
      expect(WRAPPERS.has(wrapper)).toBe(true);
    }
  });

  it('exposes the find exec primaries', () => {
    for (const flag of ['-exec', '-execdir', '-ok', '-okdir']) {
      expect(FIND_EXEC_FLAGS.has(flag)).toBe(true);
    }
  });
});
