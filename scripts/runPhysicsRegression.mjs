import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(root, '.tmp-physics-regression')
const checks = [
  { source: 'physicsRegression.ts', output: 'physicsRegression.mjs' },
  { source: 'stellarCollisionRegression.ts', output: 'stellarCollisionRegression.mjs' },
  { source: 'collisionVfxRegression.ts', output: 'collisionVfxRegression.mjs' },
  { source: 'stellarTopologyMaskRegression.ts', output: 'stellarTopologyMaskRegression.mjs' },
  { source: 'nonStellarRegression.ts', output: 'nonStellarRegression.mjs' },
  { source: 'trackingRegression.ts', output: 'trackingRegression.mjs' },
  { source: 'collisionWatchTimingRegression.ts', output: 'collisionWatchTimingRegression.mjs' },
  { source: 'stellarEvolutionRegression.ts', output: 'stellarEvolutionRegression.mjs' },
  { source: 'simulationSettingsRegression.ts', output: 'simulationSettingsRegression.mjs' },
]

rmSync(outDir, { recursive: true, force: true })

try {
  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index]
    const outputFile = resolve(outDir, check.output)

    await build({
      root,
      logLevel: 'error',
      build: {
        ssr: resolve(root, 'scripts', check.source),
        outDir,
        emptyOutDir: index === 0,
        minify: false,
        rollupOptions: {
          output: {
            entryFileNames: check.output,
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

    if ((run.status ?? 1) !== 0) {
      process.exitCode = run.status ?? 1
      break
    }
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
