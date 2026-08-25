import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(root, '.tmp-physics-regression')
const outputFile = resolve(outDir, 'physicsRegression.mjs')

rmSync(outDir, { recursive: true, force: true })

try {
  await build({
    root,
    logLevel: 'error',
    build: {
      ssr: resolve(root, 'scripts/physicsRegression.ts'),
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          entryFileNames: 'physicsRegression.mjs',
          format: 'es',
        },
      },
    },
  })

  const run = spawnSync(
    process.execPath,
    [outputFile],
    { cwd: root, stdio: 'inherit' },
  )

  process.exitCode = run.status ?? 1
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
