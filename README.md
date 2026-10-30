# Photo Editor

A web-based photo editor built with React 19, TypeScript, Vite, and Tailwind CSS v4.

## Features

- Layer-based editing with history
- Multiple tools: draw, transform, text, selection, color adjustments
- PSD import/export support
- Vector and raster layer support
- Affine transforms with retained history
- Durable history replay architecture

## Tech Stack

- **Framework**: React 19 with React Compiler
- **Language**: TypeScript 6 (strict mode)
- **Build**: Vite 8
- **Testing**: Vitest 5 with jsdom, plus Playwright for end-to-end
- **Styling**: Tailwind CSS v4 + PostCSS
- **Linting**: ESLint 10 (flat config) + Prettier
- **CI/CD**: GitHub Actions

## Getting Started

### Prerequisites

- Node.js 24+ (`.nvmrc`, and the version CI pins)
- npm 10+

#### WSL2 (optional)

For native Linux development and headless Playwright tests on Windows, see
[`docs/WSL-SETUP.md`](docs/WSL-SETUP.md).

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Testing

```bash
# Unit tests (jsdom)
npm run test

# Integration tests
npm run test:integration

# End-to-end tests (Playwright; starts the dev server itself)
npm run test:e2e

# Unit tests for the e2e helpers (Node, no browser needed)
npm run test:e2e:unit
```

See [`e2e/README.md`](e2e/README.md) for the end-to-end suite,
[`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md) for the latent defects in its test
code — none of them fails a current run — and
[`e2e/MIGRATION-TODO.md`](e2e/MIGRATION-TODO.md) for what the migration left
undone.

The e2e suite runs **headless** by default and that default should stay. A headed
run leaves a live window on your desktop, and your own clicks, keystrokes and focus
changes reach the page as real input — producing failures that belong to you, not to
the code, and that look like flakiness. `npm run test:e2e:headed` is the deliberate
opt-in for watching a visual issue.

It is enforced, not just documented: `e2e/global-setup.ts` refuses `--headed` and
`--debug` before a browser is created, and `kilo.jsonc` denies all the
window-opening commands — `--ui` included, which Playwright opens before a global
setup can run — at the agent permission layer. `AGENTS.md` states the rule
for coding agents.

## Linting & Formatting

```bash
# Check linting and formatting
npm run lint:check

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format
```

## Type Checking

```bash
npm run tsc
```

## CI/CD

The project uses GitHub Actions for continuous integration, with a read-only
`permissions: contents: read` scoping at the workflow level. No job in
`.github/workflows/ci.yml` needs to write to the repository, and the checkout
steps all set `persist-credentials: false`, so a compromised step cannot
exfiltrate a usable token. CI runs are read-only by design.

- **Check Job**: ESLint + Prettier, `npm audit --audit-level=high`, TypeScript
  (`tsc -b`, which also builds `tsconfig.e2e.json`), an assertion that every
  tracked `.ts`/`.tsx` is inside some project's `include`, unit tests, and the
  production build, on every push/PR.
- **Integration Tests**: `npm run test:integration` (PSD/file handling) is a script CI does
  not invoke; those files are collected by the Check Job's own full-suite run, which is why
  it needs no job of its own
- **E2E Unit Job**: unit tests for the e2e helpers, then a coverage run, with
  `coverage-e2e/` uploaded as an artifact. It repeats no type-check: the Check
  Job's `tsc -b` already builds `tsconfig.e2e.json`. This is the **blocking** gate
  for `e2e/`, kept as a separate job so a break in the app pipeline cannot
  silently skip the only coverage of that code.
- **E2E Job** (matrix): Playwright specs in Chrome, on Linux, Windows, and macOS.
  A **blocking** gate. It was `continue-on-error` on the stated grounds that five
  specs failed; those failures were fixed, so the comment justifying it stopped
  describing the suite and the job went on reporting a state the suite no longer
  had. Chrome is the `channel: 'chrome'` that Playwright installs — not the system
  browser. The matrix runs with `fail-fast: false` so one platform's failure does
  not cancel the others. The Linux and Windows legs will hit the fail-as-missing
  contract on `visual-regression.spec.ts` until their baselines are recorded;
  only `darwin/` baselines are committed. See
  [`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md) and
  [`e2e/README.md`](e2e/README.md).
- **Dependency licensing**: CI does not check dependency licence terms. The former
  allow/deny list was never checked against the actual dependency tree and is
  retired; do not treat it as an approved policy. `npm audit --audit-level=high`
  checks vulnerability advisories, not licences. Review the terms for dependencies
  before adding or upgrading them.

![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)

## Project Structure

```
src/
├── components/       # React components
├── contexts/         # React context providers (store, history, layers, tools)
├── hooks/            # Custom React hooks
├── tools/            # Tool implementations
├── util/             # Utility functions
├── __tests__/        # Test fixtures and setup
└── test/             # Test configuration

e2e/                  # Playwright end-to-end specs + their helper unit tests
```

## Scripts

| Script                      | Description                                                                    |
| --------------------------- | ------------------------------------------------------------------------------ |
| `dev`                       | Start development server                                                       |
| `build`                     | Build for production                                                           |
| `preview`                   | Preview production build                                                       |
| `test`                      | Run unit tests                                                                 |
| `test:integration`          | Run integration tests                                                          |
| `test:e2e`                  | Run Playwright specs (a wrapper: starts its own dev server on a port it picks) |
| `test:e2e:raw`              | The bare `playwright test`, with no wrapper                                    |
| `test:e2e:unit`             | Run e2e helper unit tests                                                      |
| `test:e2e:unit:coverage`    | e2e helper unit tests + coverage                                               |
| `test:e2e:ui`               | Playwright UI mode (opens a window)                                            |
| `test:e2e:debug`            | Playwright inspector (opens a window)                                          |
| `test:e2e:headed`           | Opt in to a visible window (warns; do not touch it)                            |
| `test:e2e:install`          | Install the Chrome browser Playwright uses                                     |
| `test:e2e:update-baselines` | Rewrite visual-regression baselines                                            |
| `test:e2e:report`           | Open the last Playwright HTML report (opens a window)                          |
| `test:e2e:clean`            | Remove generated run output                                                    |
| `tsc`                       | TypeScript type checking                                                       |
| `lint`                      | Lint with ESLint                                                               |
| `lint:check`                | Lint + format check                                                            |
| `lint:fix`                  | Auto-fix lint issues                                                           |
| `format`                    | Format with Prettier                                                           |

## License

MIT
