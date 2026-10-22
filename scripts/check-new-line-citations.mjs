import { execFileSync } from 'node:child_process';

import {
  citationsInAddedComments,
  citationsInAddedHashComments,
  citationsInAddedMarkupComments,
  citationsInAddedMarkdown,
  addedLinesByFile,
  isHashCommentFile,
  isMarkupCommentFile,
  isYamlCommentFile,
} from './lib/citations/added-comments.mjs';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options });

const baseIndex = process.argv.indexOf('--base');
let diff;
if (baseIndex === -1) {
  diff = git(['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR']);
} else {
  const base = process.argv[baseIndex + 1];
  if (!base || base.startsWith('--')) throw new Error('Expected a commit or ref after --base.');
  diff = git(['diff', '--unified=0', '--no-color', '--diff-filter=ACMR', `${base}...HEAD`, '--']);
}
const additions = addedLinesByFile(diff);
const findings = [];

for (const [fileName, lines] of additions) {
  let source;
  try {
    source = git(['show', `:${fileName}`]);
  } catch {
    continue;
  }
  if (fileName.endsWith('.md')) {
    if (fileName !== 'docs/TOOLS.md') findings.push(...citationsInAddedMarkdown(source, fileName, lines));
  } else if (isHashCommentFile(fileName)) {
    findings.push(
      ...citationsInAddedHashComments(source, fileName, lines, { yamlBlockScalars: isYamlCommentFile(fileName) })
    );
  } else if (isMarkupCommentFile(fileName)) {
    findings.push(...citationsInAddedMarkupComments(source, fileName, lines));
  } else {
    findings.push(...citationsInAddedComments(source, fileName, lines));
  }
}

if (findings.length) {
  console.error(
    'Line-number citations are prohibited in Markdown prose and source/config/markup comments. Use a symbol, title, or heading:'
  );
  for (const { fileName, line, citation } of findings) console.error(`  ${fileName}:${line} adds ${citation}`);
  process.exitCode = 1;
}
