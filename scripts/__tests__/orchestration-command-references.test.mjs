import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const DOCUMENTS = ['AGENTS.md', 'docs/ORCHESTRATION.md', 'docs/TESTING.md'];

function referencedNpmScripts() {
  const references = new Map();
  const pattern = /npm run(?: --silent)? ([A-Za-z0-9:_-]+)/g;

  for (const relativePath of DOCUMENTS) {
    const text = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
    for (const match of text.matchAll(pattern)) {
      const script = match[1];
      const line = text.slice(0, match.index).split('\n').length;
      const locations = references.get(script) ?? [];
      locations.push(`${relativePath}:${line}`);
      references.set(script, locations);
    }
  }

  return references;
}

describe('orchestration command references', () => {
  it('mentions only npm scripts that the repository defines', () => {
    const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
    const missing = [];

    for (const [script, locations] of referencedNpmScripts()) {
      if (!scripts.has(script)) missing.push(`${script} (${locations.join(', ')})`);
    }

    expect(missing).toEqual([]);
  });
});
