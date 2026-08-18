import { describe, expect, it } from 'vitest';

import { buildSharedEntryShims } from '../src/index.js';

describe('buildSharedEntryShims', () => {
  it('re-exports a name the primary entry already owns instead of re-declaring it', () => {
    // Arrange — the shape api-extractor emits per entry: `node` carries its own
    // copy of `Agent`, which the primary entry also declares and exports.
    const declarations = {
      index: `
        export declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
      `,
      node: `
        declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
        export { }
      `,
    };

    // Act
    const { shims, stats } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).not.toMatch(/interface Agent/);
    expect(shims.node).toContain("from './index.js'");
    // `Agent` joins the re-export list because `connect` names it.
    expect(stats.node.reexported).toEqual(['Agent', 'connect']);
    expect(stats.node.retained).toEqual([]);
  });

  it('imports a shared type that a retained declaration references', () => {
    // Arrange — `connect` is entry-local (the primary does not export it) but
    // its signature names `Agent`, which the primary does own.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `
        declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
        export { }
      `,
    };

    // Act
    const { shims, stats } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).toContain("import type { Agent } from './index.js';");
    expect(shims.node).toContain('export declare function connect()');
    expect(shims.node).not.toMatch(/declare interface Agent/);
    expect(stats.node.retained).toEqual(['connect']);
  });

  it('exports a type named in an exported signature, fixing TS2459', () => {
    // Arrange — the defect from issue #1928: `Agent` is reachable only as
    // `connect`'s return type, so the entry declares it without exporting it.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `
        declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
        export { }
      `,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert — `Agent` is nameable from this entry, and it resolves to the
    // primary's declaration rather than a copy of it.
    expect(shims.node).toContain("export type { Agent } from './index.js';");
    expect(shims.node).toContain("import type { Agent } from './index.js';");
  });

  it('does not export a type named only by an entry-private declaration', () => {
    // Arrange — `Agent` is referenced by a declaration this entry keeps to
    // itself, so it is not part of the entry's public surface.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `
        declare interface Agent { id: string }
        declare function internal(): Promise<Agent>;
        export declare const version: string;
        export { }
      `,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).not.toContain('export type { Agent }');
  });

  it('retains entry-local declarations and their private dependencies', () => {
    // Arrange — `Adapter` is local to `node` and depends on local `Options`.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `
        declare interface Options { retries: number }
        export declare class Adapter { constructor(options?: Options); }
        export { }
      `,
    };

    // Act
    const { shims, stats } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).toContain('declare interface Options');
    expect(shims.node).toContain('export declare class Adapter');
    expect(stats.node.retained).toEqual(['Adapter', 'Options']);
  });

  it('separates type-only re-exports from value re-exports', () => {
    // Arrange
    const declarations = {
      index: `
        export declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
      `,
      node: `
        declare interface Agent { id: string }
        export declare function connect(): Promise<Agent>;
        export { Agent }
      `,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert — a type must not travel through a value re-export, or consumers
    // using `verbatimModuleSyntax` emit a runtime import for a type.
    expect(shims.node).toContain("export { connect } from './index.js';");
    expect(shims.node).toContain("export type { Agent } from './index.js';");
  });

  it('does not treat a bound type parameter as a shared type', () => {
    // Arrange — `T` is bound by the declaration, not a reference to anything.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `
        export declare function identity<T>(value: T): T;
        export { }
      `,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).not.toMatch(/import type \{[^}]*\bT\b/);
  });

  it('preserves triple-slash type reference directives', () => {
    // Arrange — a Node entry may need `/// <reference types="node" />` to name
    // Node globals; dropping it would break the emitted shim.
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `/// <reference types="node" />
        export declare function platform(): NodeJS.Platform;
        export { }
      `,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).toContain('/// <reference types="node" />');
  });

  it('leaves the primary entry untouched so the #257 inlining survives', () => {
    // Arrange
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `export declare function connect(): void;\nexport { }`,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert — the primary rollup is the file that inlines @moltnet/* types, so
    // it must never be rewritten.
    expect(shims).not.toHaveProperty('index');
  });

  it('emits a valid empty module when an entry shares everything', () => {
    // Arrange
    const declarations = {
      index: `export declare interface Agent { id: string }`,
      node: `declare interface Agent { id: string }\nexport { }`,
    };

    // Act
    const { shims } = buildSharedEntryShims({
      declarations,
      primaryEntry: 'index',
    });

    // Assert
    expect(shims.node).toContain('export {};');
  });

  it('throws when the primary entry is missing', () => {
    // Arrange
    const declarations = { node: 'export declare function connect(): void;' };

    // Act / Assert
    expect(() =>
      buildSharedEntryShims({ declarations, primaryEntry: 'index' }),
    ).toThrow(/Primary entry "index" is missing/);
  });
});
