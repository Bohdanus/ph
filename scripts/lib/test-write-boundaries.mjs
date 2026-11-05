import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

// This is an inventory of recognizable source patterns, not runtime containment:
// dynamic destinations, imported helpers, and effects inside child processes remain opaque.
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const PROCESS_MODULES = new Set(['child_process', 'node:child_process']);
const SQLITE_MODULES = new Set(['node:sqlite']);

const FS_WRITE_APIS = new Set([
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'fchmod',
  'fchmodSync',
  'fchown',
  'fchownSync',
  'ftruncate',
  'ftruncateSync',
  'futimes',
  'futimesSync',
  'link',
  'linkSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempDisposable',
  'mkdtempDisposableSync',
  'mkdtempSync',
  'open',
  'openSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'utimes',
  'utimesSync',
  'write',
  'writeFile',
  'writeFileSync',
  'writeSync',
  'writev',
  'writevSync',
]);

const PROCESS_APIS = new Set(['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync']);

const TEST_FILE = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;

function importName(node) {
  return ts.isIdentifier(node) ? node.text : ts.isStringLiteral(node) ? node.text : null;
}

function requiredModule(initializer) {
  const expression = ts.isAwaitExpression(initializer) ? initializer.expression : initializer;
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0])
  ) {
    const isRequire = ts.isIdentifier(expression.expression) && expression.expression.text === 'require';
    const isDynamicImport = expression.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (isRequire || isDynamicImport) return expression.arguments[0].text;
  }
  return null;
}

function addBinding(bindings, localName, moduleName, importedName = null) {
  if (localName && (FS_MODULES.has(moduleName) || PROCESS_MODULES.has(moduleName) || SQLITE_MODULES.has(moduleName))) {
    bindings.set(localName, { moduleName, importedName });
  }
}

function collectBindings(sourceFile) {
  const bindings = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) continue;

      if (clause.name) addBinding(bindings, clause.name.text, moduleName);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        addBinding(bindings, clause.namedBindings.name.text, moduleName);
      } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          addBinding(bindings, element.name.text, moduleName, importName(element.propertyName ?? element.name));
        }
      }
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const moduleName = requiredModule(declaration.initializer);
      if (!moduleName) continue;

      if (ts.isIdentifier(declaration.name)) {
        addBinding(bindings, declaration.name.text, moduleName);
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          addBinding(bindings, element.name.text, moduleName, importName(element.propertyName ?? element.name));
        }
      }
    }
  }

  return bindings;
}

function expressionPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...expressionPath(node.expression), node.name.text];
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const key = ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
    return key ? [...expressionPath(node.expression), key] : [];
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    const moduleName = requiredModule(node);
    return moduleName ? [`require:${moduleName}`] : [];
  }
  return [];
}

function findApi(expression, bindings, modules, apis) {
  const path = expressionPath(expression);
  if (path.length === 0) return null;

  if (path[0].startsWith('require:')) {
    const moduleName = path[0].slice('require:'.length);
    const api = path.at(-1);
    return modules.has(moduleName) && apis.has(api) ? api : null;
  }

  const binding = bindings.get(path[0]);
  if (!binding || !modules.has(binding.moduleName)) return null;

  if (path.length === 1) {
    const api = binding.importedName;
    return api && apis.has(api) ? api : null;
  }

  const api = path.at(-1);
  if (!apis.has(api)) return null;
  return binding.importedName === null || binding.importedName === 'promises' ? api : null;
}

function processEnvPath(expression) {
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'process'
  ) {
    if (ts.isStringLiteral(expression.argumentExpression) && expression.argumentExpression.text === 'env') {
      return '<object>';
    }
    return null;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const root = expressionPath(expression.expression);
    if (root[0] === 'process' && root[1] === 'env') {
      const key = ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : '<computed>';
      return [...root.slice(2), key].join('.') || key;
    }
  }
  const path = expressionPath(expression);
  return path[0] === 'process' && path[1] === 'env' ? path.slice(2).join('.') || '<object>' : null;
}

function hasReadOnlyOption(options) {
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  for (let index = options.properties.length - 1; index >= 0; index -= 1) {
    const property = options.properties[index];
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) return false;
    if (importName(property.name) !== 'readOnly') continue;
    return ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

function lineAt(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function scanTestSource(source, fileName) {
  const scriptKind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.ts') || fileName.endsWith('.cts') || fileName.endsWith('.mts')
      ? ts.ScriptKind.TS
      : fileName.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    );
    throw new Error(`Could not parse ${fileName}: ${diagnostics.join('; ')}`);
  }

  const bindings = collectBindings(sourceFile);
  const findings = [];
  const addFinding = (kind, api, node) => findings.push({ kind, api, line: lineAt(sourceFile, node) });

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const fsApi = findApi(node.expression, bindings, FS_MODULES, FS_WRITE_APIS);
      if (fsApi) addFinding('filesystem-write', fsApi, node);

      const processApi = findApi(node.expression, bindings, PROCESS_MODULES, PROCESS_APIS);
      if (processApi) addFinding('subprocess', processApi, node);

      if (
        node.arguments.length > 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'assign' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'Object'
      ) {
        const envTarget = processEnvPath(node.arguments[0]);
        if (envTarget !== null) addFinding('process-env-write', `Object.assign:${envTarget}`, node);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const envTarget = processEnvPath(node.left);
      if (envTarget !== null) addFinding('process-env-write', `assignment:${envTarget}`, node);
    }

    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const envTarget = processEnvPath(node.operand);
      if (envTarget !== null) addFinding('process-env-write', `update:${envTarget}`, node);
    }

    if (ts.isDeleteExpression(node)) {
      const envTarget = processEnvPath(node.expression);
      if (envTarget !== null) addFinding('process-env-write', `delete:${envTarget}`, node);
    }

    if (ts.isNewExpression(node)) {
      const databaseApi = findApi(node.expression, bindings, SQLITE_MODULES, new Set(['DatabaseSync']));
      if (databaseApi) {
        const api = hasReadOnlyOption(node.arguments?.[1]) ? 'DatabaseSync:readOnly' : 'DatabaseSync:write-capable';
        addFinding('database-open', api, node);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.api.localeCompare(b.api));
}

export function deriveScriptTests(testDirectory) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        files.push(filePath);
      }
    }
  };
  visit(testDirectory);

  return files
    .map((filePath) => ({ filePath, name: relative(testDirectory, filePath).split('\\').join('/') }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ filePath, name }) => ({
      name,
      findings: scanTestSource(readFileSync(filePath, 'utf8'), name),
    }));
}
