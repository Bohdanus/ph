/**
 * The `board_post` cap, pinned in the two documents an agent is told to obey.
 *
 * Kilo's board tool refuses a long post, and the refusal was met with a rule that
 * was wrong in the direction that guarantees the failure: "rejects a body over
 * 4096 characters". The cap is on the FORMATTED message, measured in UTF-8
 * bytes, and the envelope costs 191-253 bytes, so a body inside the documented
 * limit was refused anyway. 95 posts died on the schema and 37 more on the store,
 * across 56 sessions, and the rule was in `AGENTS.md` throughout.
 *
 * So the numbers are pinned here, taken from the behaviour rather than from the
 * prose, and the two false claims are pinned as retired. Prose cannot be pinned
 * to a sentence without becoming a wording test, which this repository forbids;
 * a NUMBER and an identifier are the machine-checkable facts, and the retired
 * claims are named exactly so that reintroducing one fails.
 *
 * What this cannot pin: the cap lives in the Kilo binary, not in this
 * repository. If Kilo changes it, these figures become a floor and this test
 * becomes the thing that is wrong.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS } from '../lib/agent-board/db.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8');

/** Every claim that has been measured false, with the measurement that retired it. */
const RETIRED_CLAIMS = new Map([
  [
    /rejects a body over \d+ characters/,
    'the cap is the FORMATTED envelope in bytes: a 4090-character body passes the argument schema and is then refused by the store',
  ],
  [
    /ABORTS THE TURN/,
    '117 of 134 recorded rejections continued in the same turn; 17 ended it, and the overclaim taught an agent the failure was unrecoverable',
  ],
  [/kills the turn mid-report/, 'the same overclaim as ABORTS THE TURN, and false for the same 117'],
]);

const retiredIn = (text) =>
  [...RETIRED_CLAIMS.entries()].filter(([claim]) => claim.test(text)).map(([claim, why]) => `${claim} — ${why}`);

describe('the board_post cap the swarm text rules state', () => {
  it('is stated in BYTES, with a body budget an agent can count', () => {
    // 4096 is the cap on the formatted message; 3800 ASCII characters is what
    // survives the 191-253 byte envelope, and 1200 is the same budget when the
    // body may contain three-byte characters.
    for (const path of ['AGENTS.md', 'docs/ORCHESTRATION.md']) {
      const text = read(path);
      expect(text, path).toMatch(/4096 bytes/);
      expect(text, path).toMatch(/3800 ASCII/);
      expect(text, path).toMatch(/\b1200\b/);
    }
  });

  it('names no retired claim, in either document', () => {
    for (const path of ['AGENTS.md', 'docs/ORCHESTRATION.md']) {
      expect(retiredIn(read(path)), path).toEqual([]);
    }
  });

  it('names a way out that a peer can read without a second command, in the one document that owns it', () => {
    // The refusal is a wall, so the rule has to come with the door: an issue
    // body is not an event, is not capped, and `show` prints it. One home for
    // that, with AGENTS.md pointing at it rather than restating it.
    const owned = read('docs/ORCHESTRATION.md');
    expect(owned).toMatch(/--body/);
    expect(owned).toMatch(/swarm show/);
    expect(read('AGENTS.md')).toMatch(/docs\/ORCHESTRATION\.md/);
  });

  it("keeps the REPO board's documented limit equal to the constant the code enforces", () => {
    // Two boards, two numbers, one of them ours. The documented one is a literal
    // in a sentence; the enforced one is MAX_MESSAGE_CHARS. Deriving the claim
    // from the constant is what stops the pair from drifting apart.
    const stated = read('docs/ORCHESTRATION.md').match(/A message over (\d+) characters is refused/);
    expect(stated, 'the repository board limit is documented in prose').not.toBeNull();
    expect(Number(stated[1])).toBe(MAX_MESSAGE_CHARS);
  });
});

describe('the retired-claim detector', () => {
  it('fires on the text it was written for', () => {
    // A pin nobody has watched fail is a pin that does not work. Both sentences
    // below shipped in AGENTS.md; this is the proof the patterns still catch them.
    const shipped = [
      '`board_post` rejects a body over 4096 characters and the rejection ABORTS THE TURN',
      'the rejection kills the turn mid-report: the review that was verified, all of it unwritten',
    ];
    for (const sentence of shipped) {
      expect(retiredIn(sentence).length, sentence).toBeGreaterThan(0);
    }
  });

  it('does not fire on the rule that replaced them', () => {
    const current =
      '`board_post` caps the FORMATTED message at **4096 bytes**, not the body at 4096 characters: ' +
      'the budget is **3800 ASCII characters**, or 1200 if any may be non-ASCII.';
    expect(retiredIn(current)).toEqual([]);
  });
});
