import ts from 'typescript';

import { LINE_NUMBER_CITATION, withoutFencedCode } from './resolve.mjs';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.json',
  '.jsonc',
]);
const HASH_COMMENT_EXTENSIONS = new Set(['.yml', '.yaml', '.sh', '.bash', '.toml']);
const MARKUP_COMMENT_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml']);
const HASH_COMMENT_FILES = new Set(['.husky/pre-commit']);
const BARE_CITATION = /`:(?:\d+(?:-\d+)?(?:,?:\d+(?:-\d+)?)*)`/g;
const MARKDOWN_CITATIONS = [LINE_NUMBER_CITATION, BARE_CITATION];

export const isHashCommentFile = (fileName) => {
  const extension = fileName.slice(fileName.lastIndexOf('.'));
  return HASH_COMMENT_EXTENSIONS.has(extension) || HASH_COMMENT_FILES.has(fileName);
};

export const isYamlCommentFile = (fileName) => ['.yml', '.yaml'].includes(fileName.slice(fileName.lastIndexOf('.')));

export const isMarkupCommentFile = (fileName) =>
  MARKUP_COMMENT_EXTENSIONS.has(fileName.slice(fileName.lastIndexOf('.')));

export const addedLinesByFile = (diff) => {
  const lines = new Map();
  let path = null;
  let nextLine = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length);
      continue;
    }
    const hunk = /^@@ .* \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const extension = path?.slice(path.lastIndexOf('.'));
      if (
        path &&
        (SOURCE_EXTENSIONS.has(extension) ||
          HASH_COMMENT_EXTENSIONS.has(extension) ||
          MARKUP_COMMENT_EXTENSIONS.has(extension) ||
          extension === '.md' ||
          HASH_COMMENT_FILES.has(path))
      ) {
        const fileLines = lines.get(path) ?? new Set();
        fileLines.add(nextLine);
        lines.set(path, fileLines);
      }
      nextLine += 1;
      continue;
    }
    if (line.startsWith(' ') || (line && !line.startsWith('-'))) nextLine += 1;
  }
  return lines;
};

const citationsInCommentText = (comment, fileName, line) => {
  const findings = [];
  for (const pattern of [LINE_NUMBER_CITATION, BARE_CITATION]) {
    for (const match of comment.matchAll(pattern)) findings.push({ fileName, line, citation: match[0] });
  }
  return findings;
};

export const citationsInAddedComments = (source, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const scriptKind =
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, scriptKind, source);
  const findings = [];
  let token;

  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const start = scanner.getTokenPos();
    const comment = scanner.getTokenText();
    const startLine = source.slice(0, start).split('\n').length;
    for (const [offset, text] of comment.split('\n').entries()) {
      const line = startLine + offset;
      if (addedLines.has(line)) findings.push(...citationsInCommentText(text, fileName, line));
    }
  }

  return findings;
};

const hashCommentStart = (text, yamlSyntax = false) => {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote === '"' && character === '\\') {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && text[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    const quoteBoundary =
      index === 0 || /\s/.test(text[index - 1]) || [':', '-', '[', '{', ','].includes(text[index - 1]);
    if ((character === '"' || character === "'") && (!yamlSyntax || quoteBoundary)) {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) return index;
  }
  return -1;
};

const YAML_BLOCK_SCALAR = /(?:^|[:\-]\s)[|>](?:[1-9]?[+-]?|[+-]?[1-9]?)\s*$/;

export const citationsInAddedHashComments = (source, fileName, addedLines, { yamlBlockScalars = false } = {}) => {
  if (!addedLines?.size) return [];
  const sourceLines = source.split('\n');
  const findings = [];
  let blockIndent = null;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index];
    const line = index + 1;
    const indent = /^ */.exec(text)[0].length;

    if (yamlBlockScalars && blockIndent !== null) {
      if (!text.trim() || indent > blockIndent) continue;
      blockIndent = null;
    }

    const commentStart = hashCommentStart(text, yamlBlockScalars);
    if (addedLines.has(line) && commentStart >= 0) {
      findings.push(...citationsInCommentText(text.slice(commentStart), fileName, line));
    }

    if (yamlBlockScalars) {
      const yamlContent = text.slice(0, commentStart >= 0 ? commentStart : text.length).trimEnd();
      if (YAML_BLOCK_SCALAR.test(yamlContent)) blockIndent = indent;
    }
  }

  return findings;
};

export const citationsInAddedMarkupComments = (source, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const sourceLines = source.split('\n');
  const findings = [];
  let insideComment = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index];
    const line = index + 1;
    let cursor = 0;
    while (cursor < text.length) {
      if (!insideComment) {
        const open = text.indexOf('<!--', cursor);
        if (open < 0) break;
        insideComment = true;
        cursor = open + 4;
      }
      const close = text.indexOf('-->', cursor);
      const end = close < 0 ? text.length : close;
      if (addedLines.has(line)) findings.push(...citationsInCommentText(text.slice(cursor, end), fileName, line));
      if (close < 0) break;
      insideComment = false;
      cursor = close + 3;
    }
  }

  return findings;
};

export const citationsInAddedMarkdown = (markdown, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const prose = withoutFencedCode(markdown).split('\n');
  const findings = [];

  for (let index = 0; index < prose.length; index += 1) {
    const text = prose[index];
    const line = index + 1;
    if (!addedLines.has(line)) continue;
    for (const pattern of MARKDOWN_CITATIONS) {
      for (const match of text.matchAll(pattern)) findings.push({ fileName, line, citation: match[0] });
    }
  }

  return findings;
};
