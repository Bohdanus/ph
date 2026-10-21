import ts from 'typescript';

import { LINE_NUMBER_CITATION } from './resolve.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss']);
const BARE_CITATION = /`:(?:\d+(?:-\d+)?(?:,?:\d+(?:-\d+)?)*)`/g;

export const addedSourceLinesByFile = (diff) => {
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
      if (path && SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) {
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
    for (const pattern of [LINE_NUMBER_CITATION, BARE_CITATION]) {
      for (const match of comment.matchAll(pattern)) {
        const line = source.slice(0, start + match.index).split('\n').length;
        if (addedLines.has(line)) findings.push({ fileName, line, citation: match[0] });
      }
    }
  }

  return findings;
};
