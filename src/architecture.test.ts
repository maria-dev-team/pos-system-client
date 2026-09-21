// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve('src');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}
function imports(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) result.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
const portable = (path: string): string => path.replaceAll('\\', '/');

it('keeps shared contracts independent, Node outside the renderer, and feature internals private', () => {
  const violations: string[] = [];
  for (const file of sourceFiles(root)) {
    const source = portable(relative(root, file));
    for (const specifier of imports(file)) {
      const target = specifier.startsWith('.')
        ? portable(relative(root, resolve(dirname(file), specifier)))
        : specifier.startsWith('@renderer/')
          ? `renderer/src/${specifier.slice('@renderer/'.length)}`
          : specifier;
      const reason =
        source.startsWith('shared/') &&
        (target.startsWith('main/') ||
          target.startsWith('preload/') ||
          target.startsWith('renderer/') ||
          /^(?:react|electron)(?:\/|$)/.test(target))
          ? 'shared must not depend on a process or UI'
          : /^(?:main|preload)\//.test(source) && target.startsWith('renderer/')
            ? 'main/preload must not import renderer'
            : source.startsWith('renderer/') &&
                (target.startsWith('main/') ||
                  target.startsWith('preload/') ||
                  specifier.startsWith('node:') ||
                  builtinModules.includes(specifier) ||
                  specifier === 'electron')
              ? 'renderer must use typed preload bridges'
              : source.startsWith('renderer/src/common/') &&
                  !source.startsWith('renderer/src/common/router/') &&
                  target.startsWith('renderer/src/features/')
                ? 'common must not depend on features'
                : null;
      const feature = /^renderer\/src\/features\/([^/]+)/.exec(target)?.[1];
      const owner = /^renderer\/src\/features\/([^/]+)/.exec(source)?.[1];
      const deep =
        feature &&
        feature !== owner &&
        target !== `renderer/src/features/${feature}` &&
        target !== `renderer/src/features/${feature}/index`;
      if (reason || deep)
        violations.push(
          `${source} -> ${specifier}: ${reason ?? 'import the public feature index'}`,
        );
    }
  }
  expect(violations).toEqual([]);
});
