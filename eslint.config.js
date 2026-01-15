import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactCompiler from 'eslint-plugin-react-compiler';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['dist', 'public', 'src/assets', 'node_modules', '*.tsbuildinfo', '.DS_Store'],
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
    },
    rules: {
      'prettier/prettier': 'error',
      'react-compiler/react-compiler': 'error',
      '@typescript-eslint/no-shadow': 'error',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',
      'promise/no-return-wrap': 'error',
    },
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
    },
  },
]);
