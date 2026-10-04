/**
 * Sweep every tracked markdown document, find its line-number citations, and report what should
 * stand in their place.
 *
 * The sweep is a REPORT, and it is deliberately not an editor. A script that rewrote 3,700
 * citations unattended would produce 3,700 sentences whose anchors it had never read in context,
 * and the sentence is what decides the anchor — "the handler at `Draw.tsx:51`" and "the option
 * declared at `Draw.tsx:51`" can be the same line and want different names. So this prints a
 * worklist, one line per citation, with the resolved unit beside it, and the review is the work.
 *
 * What it does produce mechanically is the part that is genuinely mechanical and genuinely
 * valuable: the set of TARGET files, so a reviewer knows which modules to open before reading a
 * single citation, and the count per document, so the sweep can be split into files nobody has to
 * share.
 *
 * Usage:
 *   node scripts/resolve-citations.mjs                  # every tracked markdown document
 *   node scripts/resolve-citations.mjs docs/LAYERS-PANEL.md HANDOFF.md
 *   node scripts/resolve-citations.mjs --unresolved-only
 *   node scripts/resolve-citations.mjs --json
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { citationsIn, resolveCitation } from './lib/citations/resolve.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const trackedMarkdown = () =>
  execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

/**
 * Documents are read from the WORKING TREE, not from `HEAD`.
 *
 * The sweep's purpose is to describe the file a reviewer is about to edit, and a reviewer edits what
 * is on disk. Reading `HEAD` instead would make the second run of a migration describe the file as
 * it was before the first run's fixes — which is a worklist that reports as complete what is not,
 * and the worst failure mode a worklist has.
 */
const readDocument = (repoRoot, target) => readFileSync(resolve(repoRoot, target), 'utf8');

const walk = (repoRoot, targets) => {
  const rows = [];
  for (const target of targets) {
    const text = readDocument(repoRoot, target);
    for (const citation of citationsIn(text)) {
      const resolved = resolveCitation(repoRoot, citation.target, citation.line);
      rows.push({ document: target, ...citation, resolved });
    }
  }
  return rows;
};

const main = () => {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const unresolvedOnly = argv.includes('--unresolved-only');
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? undefined : argv[outIndex + 1];
  const targets = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--out');
  const documents = targets.length ? targets : trackedMarkdown();

  const rows = walk(REPO_ROOT, documents);
  const shown = unresolvedOnly ? rows.filter((row) => !row.resolved.proposal) : rows;

  if (out) {
    writeFileSync(resolve(REPO_ROOT, out), `${JSON.stringify(shown, null, 2)}\n`);
    process.stdout.write(`${shown.length} citations -> ${out}\n`);
    return;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
    return;
  }

  const byDocument = new Map();
  for (const row of shown) byDocument.set(row.document, (byDocument.get(row.document) ?? 0) + 1);
  for (const [document, count] of [...byDocument].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`\n## ${document} — ${count}\n`);
  }

  const targets_ = new Map();
  for (const row of shown) {
    if (!targets_.has(row.target)) targets_.set(row.target, new Set());
    targets_.get(row.target).add(row.line);
  }
  process.stdout.write(
    `\n# ${shown.length} citations across ${byDocument.size} documents, ${targets_.size} target files\n`
  );

  for (const row of shown) {
    const proposal = row.resolved.proposal ?? `[${row.resolved.kind}]`;
    process.stdout.write(`${row.document}\t${row.raw}\t${proposal}\n`);
  }
};

if (process.argv[1] && process.argv[1].endsWith('resolve-citations.mjs')) main();
