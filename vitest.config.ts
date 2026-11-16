import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
