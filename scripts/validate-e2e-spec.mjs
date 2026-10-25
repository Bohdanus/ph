import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function validateE2ESpec(spec, repoRoot = process.cwd()) {
  if (typeof spec !== 'string' || spec.length === 0 || spec !== spec.trim()) {
    throw new Error('spec must be one relative Playwright spec path under e2e/');
  }
  if (spec.includes('\\') || /[*?{}[\]]/.test(spec) || path.isAbsolute(spec) || path.win32.isAbsolute(spec)) {
    throw new Error('spec must be a literal relative path, not an absolute path or glob');
  }

  const segments = spec.split('/');
  if (segments[0] !== 'e2e' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('spec must resolve inside e2e/');
  }
  if (!spec.endsWith('.spec.ts') || segments.includes('__tests__') || spec.endsWith('.unit.test.ts')) {
    throw new Error('spec must be a Playwright .spec.ts file, not a helper or unit test');
  }

  const root = realpathSync(repoRoot);
  const e2eRoot = realpathSync(path.join(root, 'e2e'));
  const candidate = path.resolve(root, ...segments);
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('spec must be a regular file, not a symlink');
  }

  const resolved = realpathSync(candidate);
  const relative = path.relative(e2eRoot, resolved);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('spec must resolve inside e2e/');
  }

  return `e2e/${relative.split(path.sep).join('/')}`;
}

function main() {
  try {
    process.stdout.write(`${validateE2ESpec(process.argv[2])}\n`);
  } catch (error) {
    console.error(`Invalid E2E spec: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'validate-e2e-spec.mjs') main();
