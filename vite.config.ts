import { defineConfig } from 'vitest/config';

// GitHub Pages ではリポジトリ名のパス(例: /meal-app/)の下で配信される。
// ビルド時に BASE_PATH で上書きできる。
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.{ts,mjs}'],
  },
});
