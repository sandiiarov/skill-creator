import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'node', 'promise', 'vitest'],
  ignorePatterns: ['dist/**', 'coverage/**', 'node_modules/**', '.pi-lens/**'],
});
