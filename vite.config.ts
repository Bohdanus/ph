import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // @ts-expect-error Plugin runtime supports Babel options, but the installed Vite 8 plugin types omit this key.
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    {
      name: 'inject-commit-hash',
      apply: 'build',
      transformIndexHtml(html) {
        try {
          const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
          return html.replace('</head>', `  <!-- build: ${hash} -->\n</head>`);
        } catch {
          return html;
        }
      },
    },
  ],
  css: {
    transformer: 'postcss',
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['import', 'if-function', 'color-functions', 'global-builtin'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // The dev server watches the served root, and `.kilo/` is inside it.
  //
  // `AGENTS.md` puts every worktree at `$MAIN/.kilo/worktrees/<slug>`, so the swarm writes
  // a second checkout of this repository INTO the directory the app is served from — and
  // Vite watches that directory. The watcher does not read `.gitignore`, so the `.kilo` line
  // there buys nothing here; `resolveChokidarOptions` in Vite's dist starts from four
  // defaults — `**/.git/**`, `**/node_modules/**`, `**/test-results/**` and the cache
  // directory — and `.kilo` is none of them. The array is a literal of those four followed
  // by this one, so the defaults are KEPT; nothing here replaces them.
  //
  // MEASURED, and the cost is a torn page rather than a slow test. Vite force-reloads every
  // open page when a watched file changes that its file-name rules recognise, and
  // `reloadOnTsconfigChange` fires on a changed path ending in `/tsconfig.json` — the bare
  // one, not `tsconfig.app.json` or its two siblings — where it invalidates the whole module
  // graph and sends `full-reload` to every client. A worktree checkout writes one, so any
  // agent creating or editing a worktree reloads every page a suite has open. The document
  // is blank for the reload, so a helper probing the DOM with a non-waiting `count()` sees
  // an empty document and fails on a tool that was there a moment ago: on `main` that is
  // what `e2e/layers.spec.ts` "a layer keeps its hidden state across a reorder" reported,
  // with a pure-white failure screenshot, no console error, and a passing isolated run. The
  // mechanism above is what was reproduced here, patched against unpatched and rooted in a
  // worktree and rooted outside one; that run is not claimed to have been re-run.
  //
  // It is `.kilo` and not the served inputs because nothing under it is an input: the app
  // imports only from `src/`, and `index.html`, `vite.config.ts` and `tsconfig*.json` are
  // all outside it. No ignored file was ever part of this server's output, so nothing here
  // is weakened, and one trailing `**` covers the subtree including a worktree's own nested
  // `.git` and `node_modules`.
  //
  // **THE PATTERN IS ABSOLUTE AND ANCHORED TO THIS FILE, AND A LEADING-`**` GLOB IS WRONG.**
  // The watcher matches `ignored` against ABSOLUTE paths, and a worktree's own absolute path
  // contains `/.kilo/` — so a `**`-prefixed pattern matches every file in a served root that
  // is itself a worktree, `src/` and `index.html` and `tsconfig.json` included. Measured:
  // with one, a dev server rooted at a worktree logged no `hmr update` and no `changed
  // tsconfig file detected` line for any edit, which is a watcher switched off rather than
  // one narrowed, and no e2e run from the main checkout could tell the difference. Resolving
  // against `import.meta.dirname` is what makes the pattern mean "this checkout's own
  // `.kilo`" from either kind of root, and it is the same value the `@` alias above already
  // resolves. `src/__tests__/harness-integrity.test.ts` pins both halves of that.
  //
  // **IT DEPENDS ON THE WATCHER VITE BUNDLES, WHICH IS NOT THE ONE IN `node_modules`.** The
  // glob semantics above are the bundled copy's — `chokidar@3.6.0`, inside Vite's dist, whose
  // `ANYMATCH_OPTS` is `{ dot: true }` and whose `ignored` accepts globs. The hoisted
  // `node_modules/chokidar` is 5.0.0, and Vite's own `dependencies` do not list chokidar at
  // all, so a bump to the bundled major would leave this key INERT — a string matcher
  // becomes an exact comparison, no file matches the pattern, and every `.kilo` write
  // reloads the page again with the suite green. That is a property of a dependency's
  // internals that no test in this repository can see, so it is stated here rather than
  // pinned: a Vite upgrade is when to re-measure the three rows above.
  server: {
    watch: {
      ignored: [path.resolve(import.meta.dirname, '.kilo') + '/**'],
    },
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
    fs: {
      allow: [path.resolve(import.meta.dirname), path.resolve(import.meta.dirname, '..', '..', '..', 'node_modules')],
    },
  },
  // No `test` block here on purpose. This file is the Vite build config; unit-test
  // settings live in `vitest.config.ts` (app, jsdom) and `vitest.e2e.config.ts`
  // (e2e helpers, node). Vitest prefers `vitest.config.*` over `vite.config.ts`, so
  // a `test` block below was dead for every default invocation — but it was a live
  // footgun for `vitest --config vite.config.ts` and for any IDE runner pointed at
  // this file, because it could not know about the e2e project's existence and would
  // load every Playwright spec under `e2e/` into jsdom.
});
