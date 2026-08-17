import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

/**
 * Rewrite the secondary entries of a multi-entry declaration rollup so every
 * shared type keeps a single identity.
 *
 * `vite-plugin-dts`'s `rollupTypes` runs api-extractor once per entry, so each
 * entry gets a self-contained copy of every declaration it reaches. Two copies
 * of the same declaration are two distinct types to TypeScript — fatally so
 * when a class carries a `private` member, which no structural check can
 * bridge. Entries also compute their export list from their own surface alone,
 * so a type named only in a signature ends up declared but never exported.
 *
 * This rewrites each secondary entry to defer to the primary rollup: anything
 * the primary already exports becomes a re-export, and only genuinely
 * entry-local declarations are retained.
 *
 * See issue #1928; the `@moltnet/*` inlining property from #257 is preserved
 * because the primary rollup is left untouched.
 */
export interface SharedEntryShimInput {
  /** Rolled-up declaration text keyed by entry name (`index`, `node`, …). */
  readonly declarations: Readonly<Record<string, string>>;
  /** Entry whose rollup stays authoritative and self-contained. */
  readonly primaryEntry: string;
}

export interface SharedEntryShimStats {
  /** Names now re-exported from the primary entry instead of re-declared. */
  readonly reexported: readonly string[];
  /** Names genuinely local to this entry, kept as real declarations. */
  readonly retained: readonly string[];
}

export interface SharedEntryShimResult {
  /** Rewritten declaration text for each secondary entry. */
  readonly shims: Readonly<Record<string, string>>;
  readonly stats: Readonly<Record<string, SharedEntryShimStats>>;
}

type DeclarationKind = 'type' | 'value';

interface TopLevelDeclaration {
  readonly name: string;
  readonly kind: DeclarationKind;
  readonly statements: ts.Statement[];
  exported: boolean;
}

function parse(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    `${name}.d.ts`,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

/**
 * Index a declaration file's top-level statements by the name they introduce.
 *
 * api-extractor emits one flat statement per declaration, but a name can span
 * several statements (a function with overloads, or a class merged with an
 * interface), so statements accumulate per name rather than replacing.
 */
function collectDeclarations(
  source: ts.SourceFile,
): Map<string, TopLevelDeclaration> {
  const declarations = new Map<string, TopLevelDeclaration>();

  const record = (
    name: string,
    kind: DeclarationKind,
    statement: ts.Statement,
  ): void => {
    const existing = declarations.get(name);
    if (existing) {
      existing.statements.push(statement);
      existing.exported ||= hasExportModifier(statement);
      return;
    }
    declarations.set(name, {
      name,
      kind,
      statements: [statement],
      exported: hasExportModifier(statement),
    });
  };

  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      record(statement.name.text, 'type', statement);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      record(statement.name.text, 'type', statement);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      record(statement.name.text, 'value', statement);
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, 'value', statement);
    } else if (ts.isEnumDeclaration(statement)) {
      record(statement.name.text, 'value', statement);
    } else if (
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name)
    ) {
      record(statement.name.text, 'value', statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          record(declaration.name.text, 'value', statement);
        }
      }
    }
  }

  // `export { A, B }` marks names exported without an `export` modifier.
  for (const statement of source.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      const declaration = declarations.get(
        element.propertyName?.text ?? element.name.text,
      );
      if (declaration) {
        declaration.exported = true;
      }
    }
  }

  return declarations;
}

function exportedNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const [name, declaration] of collectDeclarations(source)) {
    if (declaration.exported) {
      names.add(name);
    }
  }
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

function leftmostIdentifier(name: ts.EntityName): string | undefined {
  let current: ts.EntityName = name;
  while (ts.isQualifiedName(current)) {
    current = current.left;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

/**
 * Names a declaration depends on, minus the type parameters it binds itself.
 *
 * Only type positions matter: a `.d.ts` has no value expressions beyond
 * heritage clauses and `typeof` queries, both of which are covered here.
 */
function referencedNames(statements: readonly ts.Statement[]): Set<string> {
  const referenced = new Set<string>();
  const bound = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isTypeParameterDeclaration(node)) {
      bound.add(node.name.text);
    } else if (ts.isTypeReferenceNode(node)) {
      const name = leftmostIdentifier(node.typeName);
      if (name) referenced.add(name);
    } else if (ts.isTypeQueryNode(node)) {
      const name = leftmostIdentifier(node.exprName);
      if (name) referenced.add(name);
    } else if (
      ts.isExpressionWithTypeArguments(node) &&
      ts.isIdentifier(node.expression)
    ) {
      referenced.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };

  for (const statement of statements) {
    visit(statement);
  }

  for (const name of bound) {
    referenced.delete(name);
  }
  return referenced;
}

function statementText(
  source: ts.SourceFile,
  declaration: TopLevelDeclaration,
): string {
  return declaration.statements
    .map((statement) => {
      const text = statement.getFullText(source).trim();
      // A name exported via a trailing `export { … }` has no export modifier on
      // its own statement; the shim drops that trailing clause, so re-attach it.
      if (declaration.exported && !hasExportModifier(statement)) {
        return `export ${text}`;
      }
      return text;
    })
    .join('\n');
}

function formatNames(names: readonly string[]): string {
  return [...names].sort((a, b) => a.localeCompare(b)).join(', ');
}

export function buildSharedEntryShims(
  input: SharedEntryShimInput,
): SharedEntryShimResult {
  const { declarations: sources, primaryEntry } = input;
  const primaryText = sources[primaryEntry];
  if (primaryText === undefined) {
    throw new Error(
      `Primary entry "${primaryEntry}" is missing from the emitted declarations.`,
    );
  }

  const primaryExports = exportedNames(parse(primaryEntry, primaryText));
  const shims: Record<string, string> = {};
  const stats: Record<string, SharedEntryShimStats> = {};

  for (const [entry, text] of Object.entries(sources)) {
    if (entry === primaryEntry) continue;

    const source = parse(entry, text);
    const declarations = collectDeclarations(source);

    const reexported: string[] = [];
    const retainedNames = new Set<string>();
    const queue: string[] = [];

    for (const [name, declaration] of declarations) {
      if (!declaration.exported) continue;
      if (primaryExports.has(name)) {
        reexported.push(name);
      } else {
        retainedNames.add(name);
        queue.push(name);
      }
    }

    // A retained declaration may reach further entry-local declarations; pull
    // those in too, and route everything the primary owns through an import so
    // the shim never re-declares a shared type.
    const imported = new Set<string>();
    const namedInSignatures = new Set<string>();
    while (queue.length > 0) {
      const name = queue.pop();
      if (name === undefined) continue;
      const declaration = declarations.get(name);
      if (!declaration) continue;

      for (const reference of referencedNames(declaration.statements)) {
        if (reference === name) continue;
        if (primaryExports.has(reference)) {
          imported.add(reference);
        } else if (
          declarations.has(reference) &&
          !retainedNames.has(reference)
        ) {
          retainedNames.add(reference);
          queue.push(reference);
        }
        // Anything else is a global (Promise, Uint8Array, NodeJS, …): a
        // self-contained rollup declares every non-global name it references.
      }
    }

    // A type named in an exported signature must be exported by this entry too,
    // or a consumer cannot annotate against it (TS2459) — the second half of
    // issue #1928. Re-exporting is safe precisely because these names now
    // resolve to the primary entry's declaration, not a copy of it.
    for (const declaration of declarations.values()) {
      if (!declaration.exported) continue;
      for (const reference of referencedNames(declaration.statements)) {
        if (primaryExports.has(reference)) {
          namedInSignatures.add(reference);
        }
      }
    }
    for (const name of namedInSignatures) {
      if (!reexported.includes(name)) {
        reexported.push(name);
      }
    }

    const kindOf = (name: string): DeclarationKind =>
      declarations.get(name)?.kind ?? 'type';
    const typeReexports = reexported.filter((name) => kindOf(name) === 'type');
    const valueReexports = reexported.filter((name) => kindOf(name) !== 'type');

    const lines: string[] = [];
    for (const directive of source.typeReferenceDirectives) {
      lines.push(`/// <reference types="${directive.fileName}" />`);
    }
    if (lines.length > 0) lines.push('');

    lines.push(
      `// Generated from ${primaryEntry}.d.ts — shared declarations are re-exported`,
      `// rather than duplicated, so every type has one identity across entries.`,
      '',
    );

    if (imported.size > 0) {
      lines.push(
        `import type { ${formatNames([...imported])} } from './${primaryEntry}.js';`,
        '',
      );
    }
    if (valueReexports.length > 0) {
      lines.push(
        `export { ${formatNames(valueReexports)} } from './${primaryEntry}.js';`,
      );
    }
    if (typeReexports.length > 0) {
      lines.push(
        `export type { ${formatNames(typeReexports)} } from './${primaryEntry}.js';`,
      );
    }
    if (valueReexports.length > 0 || typeReexports.length > 0) {
      lines.push('');
    }

    for (const name of [...retainedNames].sort((a, b) => a.localeCompare(b))) {
      const declaration = declarations.get(name);
      if (declaration) {
        lines.push(statementText(source, declaration), '');
      }
    }

    if (
      valueReexports.length + typeReexports.length + retainedNames.size ===
      0
    ) {
      lines.push('export {};', '');
    }

    shims[entry] = `${lines.join('\n').trimEnd()}\n`;
    stats[entry] = {
      reexported: [...reexported].sort((a, b) => a.localeCompare(b)),
      retained: [...retainedNames].sort((a, b) => a.localeCompare(b)),
    };
  }

  return { shims, stats };
}

export interface ShareRolledUpEntriesOptions {
  /** Directory holding the emitted `.d.ts` files, usually the package `dist`. */
  readonly outDir: string;
  /** Entry that keeps its full rollup. Defaults to `index`. */
  readonly primaryEntry?: string;
  /**
   * Secondary entries to rewrite. Defaults to every other `.d.ts` in `outDir`,
   * which is safe because the build empties the directory first.
   */
  readonly entries?: readonly string[];
  /** Progress sink. Defaults to `console.log`. */
  readonly log?: (message: string) => void;
}

/**
 * Rewrite a package's secondary declaration entries in place so shared types
 * resolve to one declaration.
 *
 * Call from `vite-plugin-dts`'s `afterBuild` hook, which runs once every
 * rolled-up `.d.ts` has been written:
 *
 * ```ts
 * dts({
 *   rollupTypes: true,
 *   afterBuild: () => shareRolledUpEntries({ outDir: 'dist' }),
 * })
 * ```
 */
export function shareRolledUpEntries(
  options: ShareRolledUpEntriesOptions,
): void {
  const { outDir, primaryEntry = 'index', log = console.log } = options;

  const entries =
    options.entries ??
    readdirSync(outDir)
      .filter((file) => file.endsWith('.d.ts'))
      .map((file) => file.slice(0, -'.d.ts'.length))
      .filter((entry) => entry !== primaryEntry);

  if (entries.length === 0) {
    return;
  }

  const declarations: Record<string, string> = {
    [primaryEntry]: readFileSync(join(outDir, `${primaryEntry}.d.ts`), 'utf8'),
  };
  for (const entry of entries) {
    declarations[entry] = readFileSync(join(outDir, `${entry}.d.ts`), 'utf8');
  }

  const { shims, stats } = buildSharedEntryShims({
    declarations,
    primaryEntry,
  });

  for (const [entry, contents] of Object.entries(shims)) {
    const before = declarations[entry]?.length ?? 0;
    writeFileSync(join(outDir, `${entry}.d.ts`), contents);
    const { reexported, retained } = stats[entry] ?? {
      reexported: [],
      retained: [],
    };
    log(
      `dts-entry-shims: ${entry}.d.ts now shares ${primaryEntry}.d.ts ` +
        `(${reexported.length} re-exported, ${retained.length} entry-local, ` +
        `${before} → ${contents.length} bytes)`,
    );
  }
}
