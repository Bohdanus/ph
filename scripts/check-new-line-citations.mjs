import { execFileSync } from 'node:child_process';

import { citationsInAddedComments, addedSourceLinesByFile } from './lib/citations/added-comments.mjs';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options });

const diff = git(['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR']);
const additions = addedSourceLinesByFile(diff);
const findings = [];

for (const [fileName, lines] of additions) {
  let source;
  try {
    source = git(['show', `:${fileName}`]);
  } catch {
    continue;
  }
  findings.push(...citationsInAddedComments(source, fileName, lines));
}

if (findings.length) {
  console.error('Line-number citations are prohibited in source comments. Use a symbol, test title, or file name:');
  for (const { fileName, line, citation } of findings) console.error(`  ${fileName}:${line} adds ${citation}`);
  process.exitCode = 1;
}
