import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactCompiler from 'eslint-plugin-react-compiler';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import promise from 'eslint-plugin-promise';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: [
      'dist',
      'public',
      'src/assets',
      'node_modules',
      '*.tsbuildinfo',
      '.DS_Store',
      '.husky',
      'coverage',
      '.vite',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    plugins: {
      prettier,
      'react-compiler': reactCompiler,
      promise,
    },
    rules: {
      'prettier/prettier': 'error',
      'react-compiler/react-compiler': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/globals': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-shadow': 'warn',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'promise/no-return-wrap': 'error',

      // Style/noise issues - downgrade to warn
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-useless-assignment': 'warn',
      'no-case-declarations': 'warn',

      // Fast refresh - style only, not a runtime bug
      'react-refresh/only-export-components': 'warn',

      // Keep as error - these are real bugs
      // react-hooks/refs - accessing refs during render
      // react-hooks/set-state-in-effect - setState in useEffect
      // react-hooks/globals - reassignment outside component
      // react-hooks/rules-of-hooks - hook rules violations
      // react-compiler/react-compiler - compiler violations
      // react-hooks/immutability - mutating refs
      // @typescript-eslint/no-non-null-asserted-optional-chain - unsafe optional chain
    },
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
    },
  },
  {
    // Selection tools intentionally omit exhaustive-deps for performance; the
    // React Compiler skip is an optimization concern, not a runtime bug.
    files: [
      'src/components/Main/FeatherMagneticLassoToolArea.tsx',
      'src/components/Main/MagicWandToolArea.tsx',
      'src/components/Main/PolygonClickToolArea.tsx',
    ],
    rules: {
      'react-compiler/react-compiler': 'warn',
    },
  },
  {
    // Floating UI arrow middleware legitimately receives a ref object that is
    // only read during layout effects, not during render.
    files: ['src/components/PreviewTooltip/BmpPreviewTooltip.tsx'],
    rules: {
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Refs are intentionally stored as reducer-managed context state; the
    // initializer never reads ref.current, so this is a static false positive.
    files: ['src/contexts/StoreContext.tsx'],
    rules: {
      'react-hooks/refs': 'warn',
    },
  },
]);
