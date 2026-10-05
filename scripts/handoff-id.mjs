#!/usr/bin/env node
/**
 * Mints the id a new handoff entry carries in place of a number.
 *
 * WHY A SHA AND NOT A NUMBER
 * --------------------------
 * A number is a shared allocator with no owner. Every session that appends an
 * entry reads the same highest number in the document and claims it, so two
 * sessions adding one entry each collide by construction, and the merge is what
 * arbitrates — a conflict over prose, resolved by whoever renumbers last, with
 * the loser silently renumbering a second time when another session lands in
 * between. A sha derived from the entry's own title needs no allocator, so the
 * collision cannot be created rather than merely being unlikely.
 *
 * WHY DERIVED FROM THE TITLE RATHER THAN RANDOM
 * ---------------------------------------------
 * A random id has to be written down, and an id nobody can reproduce is an id
 * nobody can check. Deriving it means the same title always yields the same id,
 * so a second session minting the same entry gets the same answer instead of a
 * second id, and `npm run handoff:id` can also report the id a title already
 * holds. The cost, and it is a real one: **retitling an entry changes its id**,
 * which makes the board read the entry as a new item. So mint once, on creation,
 * and do not recompute it after the fact.
 *
 * LENGTH
 * ------
 * Seven hex characters, the git short-sha length the parser accepts as its
 * floor. Seven hex characters is 28 bits: a thousand entries collide with
 * probability around one in two million, and a document holds tens.
 *
 * USAGE
 * -----
 *     npm run handoff:id -- "The crop commits on Enter but not on Escape"
 *
 * With no argument it reads the title from stdin, so a title containing shell
 * metacharacters or quotes does not need escaping.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The parser's floor for a sha id. Shorter and `handoff-import.mjs` will not read it as one. */
const LENGTH = 7;

/**
 * The headings that already carry an id, so a re-run reports the id a title
 * holds rather than minting a second one for the same entry.
 *
 * Read from the working tree, not from `main`, because the entry being written
 * is in the working tree by the time anybody re-runs this.
 *
 * @param {string} root the repository root
 * @returns {Map<string, string>} normalised title → id
 */
function idsInHandoff(root) {
  const byTitle = new Map();
  let text;
  try {
    text = readFileSync(join(root, 'HANDOFF.md'), 'utf8');
  } catch {
    return byTitle;
  }
  const heading = /^##\s+(?:item\s+)?#?(\d{1,9}|[0-9a-f]{7,40})\b[ \t]*(.*)$/gim;
  for (const [, id, rest] of text.matchAll(heading)) {
    const title = rest
      .replace(/^[-–—:.)]+[ \t]*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (title !== '' && !byTitle.has(title)) byTitle.set(title, id.toLowerCase());
  }
  return byTitle;
}

/**
 * Collapses a title to the form both the hash and the lookup use, so
 * `Handoff  ID` and `handoff-id` are the same title and mint the same id.
 *
 * @param {string} title
 * @returns {string}
 */
function normalize(title) {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function readTitle(argv) {
  const given = argv.join(' ').trim();
  if (given !== '') return given;
  if (process.stdin.isTTY) return '';
  const piped = await new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
  });
  return piped.trim();
}

const title = await readTitle(process.argv.slice(2));

if (title === '') {
  process.stderr.write(
    'handoff-id: give the entry title, as an argument or on stdin\n\n  npm run handoff:id -- "the title"\n'
  );
  process.exit(2);
}

/**
 * `sha256` rather than `sha1`: both are collision-resistant enough at 28 bits,
 * and nothing here is a security boundary, but sha256 is the default everywhere
 * else in the repository and one hash is easier to reason about than two.
 */
const id = createHash('sha256').update(normalize(title)).digest('hex').slice(0, LENGTH);
const existing = idsInHandoff(process.cwd()).get(normalize(title));

if (existing !== undefined && existing !== id) {
  /**
   * The title already exists under a different id, which means it was minted
   * before, retitled, or re-hashed by a change to this derivation. Reporting
   * rather than overwriting is the point: the entry keeps the id the board
   * already holds, and a silent second id would file it as new work.
   */
  process.stdout.write(`${existing}\n`);
  process.stderr.write(`handoff-id: that title already holds the id ${existing}; kept it rather than minting ${id}\n`);
} else {
  process.stdout.write(`${id}\n`);
}
