# Photo Editor

Web-based photo editor: React 19, TypeScript 6, Vite 8, Tailwind CSS v4.

## Features

- Layer-based editing with history
- Tools: draw, transform, text, selection, color adjustments
- PSD import/export
- Vector & raster layers
- Affine transforms with retained history
- Durable history replay

## Tech Stack

| Category  | Stack                         |
| --------- | ----------------------------- |
| Framework | React 19 + React Compiler     |
| Language  | TypeScript 6 (strict)         |
| Build     | Vite 8                        |
| Testing   | Vitest 5 (jsdom) + Playwright |
| Styling   | Tailwind CSS v4 + PostCSS     |
| Linting   | ESLint 10 (flat) + Prettier   |
| CI/CD     | GitHub Actions                |

## Getting Started

**Prerequisites:** Node.js 24+ (`.nvmrc`), npm 10+

```bash
npm install
npm run dev      # development
npm run build    # production build
npm run preview  # preview build
```

WSL2: see [`docs/WSL-SETUP.md`](docs/WSL-SETUP.md).

## Testing

```bash
npm run test           # unit (jsdom)
npm run test:integration  # integration (PSD/file)
npm run test:e2e       # e2e (Playwright, headless by default)
npm run test:e2e:unit  # e2e helper unit tests
```

Headless is default and enforced. Headed runs (`npm run test:e2e:headed`) are opt-in; your interactions become real input causing flaky-looking failures. Enforced by `e2e/global-setup.ts` and `kilo.jsonc`; `AGENTS.md` states the rule.

See [`e2e/README.md`](e2e/README.md), [`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md), [`e2e/MIGRATION-TODO.md`](e2e/MIGRATION-TODO.md).

## Linting & Type Checking

```bash
npm run lint:check   # lint + format check
npm run lint:fix     # auto-fix
npm run format       # format
npm run tsc          # type check
```

## CI/CD

GitHub Actions, read-only (`permissions: contents: read`, `persist-credentials: false`).

| Job          | Purpose                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check        | ESLint, Prettier, `npm audit --audit-level=high`, `tsc -b` (builds `tsconfig.e2e.json`), project include assertion, unit tests, production build |
| Integration  | Collected by Check Job's full-suite run (no separate job)                                                                                        |
| E2E Unit     | e2e helper tests + coverage; **blocking** gate for `e2e/`; reuses Check Job's `tsc -b`                                                           |
| E2E (matrix) | Playwright in Chrome on Linux/Windows/macOS; **blocking** gate; `fail-fast: false`; Linux/Windows need baseline recordings                       |

Dependency licensing: not checked. Former allow/deny list retired. `npm audit` checks vulnerabilities only.

## Project Structure

```
src/
├── components/   # React components
├── contexts/     # React context providers (store, history, layers, tools)
├── hooks/        # Custom React hooks
├── tools/        # Tool implementations
├── util/         # Utility functions
├── __tests__/    # Test fixtures and setup
└── test/         # Test configuration
e2e/              # Playwright specs + helper unit tests
```

## Scripts

| Script                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `dev`                       | Start dev server                                 |
| `build`                     | Production build                                 |
| `preview`                   | Preview production build                         |
| `test`                      | Unit tests                                       |
| `test:integration`          | Integration tests                                |
| `test:e2e`                  | Playwright specs (wrapper starts own dev server) |
| `test:e2e:raw`              | Bare `playwright test`                           |
| `test:e2e:unit`             | e2e helper unit tests                            |
| `test:e2e:unit:coverage`    | e2e helpers + coverage                           |
| `test:e2e:ui`               | Playwright UI (opens window)                     |
| `test:e2e:debug`            | Playwright inspector (opens window)              |
| `test:e2e:headed`           | Visible window (opt-in, don't touch)             |
| `test:e2e:install`          | Install Playwright Chrome                        |
| `test:e2e:update-baselines` | Rewrite visual-regression baselines              |
| `test:e2e:report`           | Open last HTML report                            |
| `test:e2e:clean`            | Remove run output                                |
| `tsc`                       | TypeScript check                                 |
| `lint`                      | ESLint                                           |
| `lint:check`                | Lint + format check                              |
| `lint:fix`                  | Auto-fix lint                                    |
| `format`                    | Prettier                                         |

## License

MIT
