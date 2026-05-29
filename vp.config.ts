import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    cache: true,
    tasks: {
      compile: {
        command: 'pnpm run compile',
        cache: true,
        input: [
          'src/**',
          'packages/*/src/**',
          'tsconfig.json',
          'packages/*/tsconfig.json',
          'package.json',
          'packages/*/package.json',
        ],
        output: ['out/**', 'packages/*/dist/**'],
      },
      test: {
        command: 'pnpm run test',
        cache: false,
        dependsOn: ['compile'],
      },
      package: {
        command: 'pnpm run package',
        cache: false,
        dependsOn: ['compile'],
      },
    },
  },
});
