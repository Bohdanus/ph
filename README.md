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
- **Testing**: Vitest 5 with jsdom
- **Styling**: Tailwind CSS v4 + PostCSS
- **Linting**: ESLint 10 (flat config) + Prettier
- **CI/CD**: GitHub Actions

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+

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
# Run all tests
npm run test

# Run integration tests
npm run test:integration
```

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

The project uses GitHub Actions for continuous integration:

- **Check Job**: TypeScript, lint, tests, and build on every push/PR
- **Security Audit**: npm audit for high-severity vulnerabilities
- **Dependency Review**: License and vulnerability scanning on PRs
- **Integration Tests**: Additional test suite for PSD/file handling

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
```

## Scripts

| Script             | Description              |
| ------------------ | ------------------------ |
| `dev`              | Start development server |
| `build`            | Build for production     |
| `preview`          | Preview production build |
| `test`             | Run unit tests           |
| `test:integration` | Run integration tests    |
| `tsc`              | TypeScript type checking |
| `lint`             | Lint with ESLint         |
| `lint:check`       | Lint + format check      |
| `lint:fix`         | Auto-fix lint issues     |
| `format`           | Format with Prettier     |

## License

MIT
