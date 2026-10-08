import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig({
  test: {
    include: ['tests/integracao/**/*.test.ts'],
    env: loadEnv('test', process.cwd(), ''),
    testTimeout: 20_000,
    fileParallelism: false,
  },
})
