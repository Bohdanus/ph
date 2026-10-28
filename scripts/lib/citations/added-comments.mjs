import ts from 'typescript';

import { LINE_NUMBER_CITATION, withoutFencedCode } from './resolve.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc']);
const CSS_COMMENT_EXTENSIONS = new Set(['.css', '.scss']);
const HASH_COMMENT_EXTENSIONS = new Set(['.yml', '.yaml', '.sh', '.bash', '.toml']);
const MARKUP_COMMENT_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml']);
const HASH_COMMENT_FILES = new Set([
  '.husky/pre-commit',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.npmignore',
  '.npmrc',
  '.editorconfig',
]);
const BARE_CITATION = /`:(?:\d+(?:-\d+)?(?:,?:\d+(?:-\d+)?)*)`/g;
const MARKDOWN_CITATIONS = [LINE_NUMBER_CITATION, BARE_CITATION];

export const isHashCommentFile = (fileName) => {
  const extension = fileName.slice(fileName.lastIndexOf('.'));
  const basename = fileName.slice(fileName.lastIndexOf('/') + 1);
  return HASH_COMMENT_EXTENSIONS.has(extension) || HASH_COMMENT_FILES.has(fileName) || HASH_COMMENT_FILES.has(basename);
};

const decodeGitPath = (gitPath) => {
  if (!gitPath.startsWith('"') || !gitPath.endsWith('"')) return gitPath;
  const encoded = gitPath.slice(1, -1);
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] !== '\\') {
      bytes.push(...new TextEncoder().encode(encoded[index]));
      continue;
    }
    const escape = encoded[index + 1];
    const octal = /^[0-7]{3}/.exec(encoded.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    const escaped = { t: 9, n: 10, r: 13, b: 8, f: 12, v: 11, '\\': 92, '"': 34 }[escape];
    if (escaped !== undefined) {
      bytes.push(escaped);
      index += 1;
      continue;
    }
    bytes.push(92);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};

export const isYamlCommentFile = (fileName) => ['.yml', '.yaml'].includes(fileName.slice(fileName.lastIndexOf('.')));

export const isMarkupCommentFile = (fileName) =>
  MARKUP_COMMENT_EXTENSIONS.has(fileName.slice(fileName.lastIndexOf('.')));

export const addedLinesByFile = (diff) => {
  const lines = new Map();
  let path = null;
  let nextLine = 0;
  let inHunk = false;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = null;
      inHunk = false;
      continue;
    }
    if (inHunk) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith('+')) {
        const extension = path?.slice(path.lastIndexOf('.'));
        const basename = path?.slice(path.lastIndexOf('/') + 1);
        if (
          path &&
          (SOURCE_EXTENSIONS.has(extension) ||
            CSS_COMMENT_EXTENSIONS.has(extension) ||
            HASH_COMMENT_EXTENSIONS.has(extension) ||
            MARKUP_COMMENT_EXTENSIONS.has(extension) ||
            extension === '.md' ||
            extension === '.mdx' ||
            HASH_COMMENT_FILES.has(path) ||
            HASH_COMMENT_FILES.has(basename))
        ) {
          const fileLines = lines.get(path) ?? new Set();
          fileLines.add(nextLine);
          lines.set(path, fileLines);
        }
        nextLine += 1;
      } else if (line.startsWith(' ')) {
        nextLine += 1;
      } else if (line.startsWith('-')) {
        // Removed lines do not occupy positions in the resulting file.
      } else {
        inHunk = false;
      }
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = decodeGitPath(line.slice('+++ '.length));
      path = target.startsWith('b/') ? target.slice(2) : null;
      continue;
    }
    const hunk = /^@@ .* \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      nextLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
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

export const citationsInAddedCssComments = (source, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const findings = [];
  const scss = fileName.endsWith('.scss');
  let inBlockComment = false;
  let line = 1;
  let index = 0;
  let parenthesisDepth = 0;

  while (index < source.length) {
    const character = source[index];
    if (character === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (inBlockComment) {
      const close = source.indexOf('*/', index);
      const end = close < 0 ? source.length : close;
      const comment = source.slice(index, end);
      for (const [offset, text] of comment.split('\n').entries()) {
        const commentLine = line + offset;
        if (addedLines.has(commentLine)) findings.push(...citationsInCommentText(text, fileName, commentLine));
      }
      line += (comment.match(/\n/g) ?? []).length;
      index = close < 0 ? source.length : close + 2;
      inBlockComment = close < 0;
      continue;
    }
    const urlStart = /^url\(/i.exec(source.slice(index));
    const previousIsCssName = index > 0 && (/[\w-\\]/.test(source[index - 1]) || source.charCodeAt(index - 1) >= 0x80);
    if (urlStart && !previousIsCssName) {
      let cursor = index + urlStart[0].length;
      let depth = 1;
      let urlQuote = null;
      while (cursor < source.length && depth > 0) {
        const current = source[cursor];
        if (current === '\\') {
          cursor += 2;
          continue;
        }
        if (urlQuote) {
          if (current === urlQuote) urlQuote = null;
        } else if (current === '"' || current === "'") urlQuote = current;
        else if (current === '(') depth += 1;
        else if (current === ')') depth -= 1;
        cursor += 1;
      }
      line += (source.slice(index, cursor).match(/\n/g) ?? []).length;
      index = cursor;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          if (source[index + 1] === '\n') line += 1;
          index += 2;
          continue;
        }
        if (source[index] === '\n') line += 1;
        if (source[index++] === quote) break;
      }
      continue;
    }
    if (source.startsWith('/*', index)) {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (character === '(') parenthesisDepth += 1;
    else if (character === ')' && parenthesisDepth > 0) parenthesisDepth -= 1;
    if (scss && source.startsWith('//', index)) {
      if (parenthesisDepth === 0) {
        const end = source.indexOf('\n', index);
        const comment = source.slice(index, end < 0 ? source.length : end);
        if (addedLines.has(line)) findings.push(...citationsInCommentText(comment, fileName, line));
        index = end < 0 ? source.length : end;
        continue;
      }
    }
    index += 1;
  }

  return findings;
};

const hashCommentInfo = (text, yamlSyntax = false, initialQuote = null) => {
  let quote = initialQuote;
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
    const prefix = text.slice(0, index).trimEnd();
    const quoteBoundary =
      !prefix ||
      [':', '[', '{', ',', '-'].includes(prefix.at(-1)) ||
      (yamlSyntax && /(?:^|\s)(?:!!?[^\s]+|![^\s]+|&[^\s]+)\s+$/.test(text.slice(0, index)));
    if ((character === '"' || character === "'") && (!yamlSyntax || quoteBoundary)) {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return { commentStart: index, openQuote: quote };
    }
  }
  return { commentStart: -1, openQuote: quote };
};

const YAML_BLOCK_SCALAR = /(?:^|:\s+|\-\s+)(?:(?:!!?[^\s]+|![^\s]+|&[^\s]+)\s+)*(?:[|>])(?:[1-9][+-]?|[+-]?[1-9])?\s*$/;

export const citationsInAddedHashComments = (source, fileName, addedLines, { yamlBlockScalars = false } = {}) => {
  if (!addedLines?.size) return [];
  const sourceLines = source.split('\n');
  const findings = [];
  let blockIndent = null;
  let multilineQuote = null;
  let awaitingBlockValueIndent = null;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index];
    const line = index + 1;
    const indent = /^ */.exec(text)[0].length;

    if (yamlBlockScalars && blockIndent !== null) {
      if (!text.trim() || indent > blockIndent) continue;
      blockIndent = null;
    }

    if (yamlBlockScalars && awaitingBlockValueIndent !== null) {
      if (!text.trim()) continue;
      if (/^\s*#/.test(text)) {
        // YAML comments may separate a key from its indented block scalar value.
      } else if (
        indent > awaitingBlockValueIndent &&
        /^(?:(?:!!?[^\s]+|![^\s]+|&[^\s]+)\s+)*(?:[|>])(?:[1-9][+-]?|[+-]?[1-9])?\s*(?:#.*)?$/.test(text.trim())
      ) {
        blockIndent = indent;
        awaitingBlockValueIndent = null;
      } else {
        awaitingBlockValueIndent = null;
      }
    }

    const { commentStart, openQuote } = hashCommentInfo(text, yamlBlockScalars, multilineQuote);
    if (addedLines.has(line) && commentStart >= 0) {
      findings.push(...citationsInCommentText(text.slice(commentStart), fileName, line));
    }
    multilineQuote = yamlBlockScalars ? openQuote : null;

    if (yamlBlockScalars) {
      const yamlContent = text.slice(0, commentStart >= 0 ? commentStart : text.length).trimEnd();
      if (YAML_BLOCK_SCALAR.test(yamlContent)) blockIndent = indent;
      if (/:\s*$/.test(yamlContent)) awaitingBlockValueIndent = indent;
    }
  }

  return findings;
};

export const citationsInAddedShellAndTomlComments = (source, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const findings = [];
  const isShell = fileName.endsWith('.sh') || fileName.endsWith('.bash') || fileName === '.husky/pre-commit';
  const basename = fileName.slice(fileName.lastIndexOf('/') + 1);
  const isIgnoreFile = ['.gitignore', '.gitattributes', '.dockerignore', '.npmignore'].includes(basename);
  const supportsSemicolonComments = ['.npmrc', '.editorconfig'].includes(basename);
  let multilineQuote = null;
  let heredocs = [];
  const lines = source.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = lines[lineIndex];
    const line = lineIndex + 1;
    if (heredocs.length) {
      const { delimiter, stripTabs } = heredocs[0];
      const terminator = stripTabs ? text.replace(/^\t+/, '') : text;
      if (terminator === delimiter) heredocs.shift();
      continue;
    }

    let commentStart = -1;
    const nextHeredocs = [];
    let quote = null;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (!isShell && multilineQuote) {
        let close = text.indexOf(multilineQuote, index);
        while (close >= 0 && multilineQuote === '"""') {
          let slashes = 0;
          for (let prior = close - 1; prior >= 0 && text[prior] === '\\'; prior -= 1) slashes += 1;
          if (slashes % 2 === 0) break;
          close = text.indexOf(multilineQuote, close + multilineQuote.length);
        }
        if (close < 0) break;
        index = close + multilineQuote.length - 1;
        multilineQuote = null;
        continue;
      }
      if (quote) {
        if (isShell && quote === "'" && char === "'") quote = null;
        else if (char === '\\' && quote === '"') escaped = !escaped;
        else if (char === quote && !escaped) quote = null;
        else escaped = false;
        continue;
      }
      if (char === '"' || char === "'") {
        if (!isShell && text.startsWith(char.repeat(3), index)) {
          multilineQuote = char.repeat(3);
          index += 2;
        } else quote = char;
        continue;
      }
      if (isShell && text.startsWith('<<', index) && text[index + 2] !== '<') {
        let cursor = index + 2;
        const stripTabs = text[cursor] === '-';
        if (stripTabs) cursor += 1;
        while (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1;
        let delimiter = '';
        let delimiterQuote = null;
        let delimiterStarted = false;
        while (cursor < text.length) {
          const token = text[cursor];
          if (delimiterQuote === "'") {
            if (token === "'") delimiterQuote = null;
            else delimiter += token;
            cursor += 1;
            continue;
          }
          if (delimiterQuote === '"') {
            if (token === '"') delimiterQuote = null;
            else if (token === '\\' && /[\\$`"]/.test(text[cursor + 1] ?? '')) {
              delimiter += text[cursor + 1];
              cursor += 2;
              continue;
            } else delimiter += token;
            cursor += 1;
            continue;
          }
          if (/[\s;&|()]/.test(token)) break;
          if (token === "'" || token === '"') {
            delimiterStarted = true;
            delimiterQuote = token;
            cursor += 1;
            continue;
          }
          if (token === '\\' && cursor + 1 < text.length) {
            delimiterStarted = true;
            delimiter += text[cursor + 1];
            cursor += 2;
            continue;
          }
          delimiterStarted = true;
          delimiter += token;
          cursor += 1;
        }
        if (delimiterStarted) nextHeredocs.push({ delimiter, stripTabs });
        index = cursor - 1;
        continue;
      }
      const shellBoundary = index === 0 || /\s/.test(text[index - 1]) || /[;&|(){}<>]/.test(text[index - 1]);
      const isLineComment = char === '#' && (isIgnoreFile ? text.slice(0, index).trim() === '' : shellBoundary);
      const isSemicolonComment =
        supportsSemicolonComments && char === ';' && (index === 0 || /\s/.test(text[index - 1]));
      if (isLineComment || isSemicolonComment) {
        commentStart = index;
        break;
      }
    }

    if (commentStart >= 0 && addedLines.has(line)) {
      findings.push(...citationsInCommentText(text.slice(commentStart), fileName, line));
    }
    if (nextHeredocs.length) heredocs = nextHeredocs;
  }

  return findings;
};

export const citationsInAddedMarkupComments = (source, fileName, addedLines) => {
  if (!addedLines?.size) return [];
  const sourceLines = source.split('\n');
  const findings = [];
  let insideComment = false;
  let insideCdata = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index];
    const line = index + 1;
    let cursor = 0;
    while (cursor < text.length) {
      if (insideCdata) {
        const closeCdata = text.indexOf(']]>', cursor);
        if (closeCdata < 0) break;
        insideCdata = false;
        cursor = closeCdata + 3;
        continue;
      }
      if (!insideComment) {
        const open = text.indexOf('<!--', cursor);
        const cdata = text.indexOf('<![CDATA[', cursor);
        if (cdata >= 0 && (open < 0 || cdata < open)) {
          const closeCdata = text.indexOf(']]>', cdata + 9);
          if (closeCdata < 0) {
            insideCdata = true;
            break;
          }
          cursor = closeCdata + 3;
          continue;
        }
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
