import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(root, '.tmp-physics-regression')
const tsc = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
)

rmSync(outDir, { recursive: true, force: true })

const compile = spawnSync(
  tsc,
  [
    resolve(root, 'scripts/physicsRegression.ts'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'Node',
    '--rootDir', root,
    '--outDir', outDir,
    '--strict',
    '--esModuleInterop',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
)

if (compile.status !== 0) {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(compile.status ?? 1)
}

writeFileSync(resolve(outDir, 'package.json'), '{"type":"commonjs"}\n')

const run = spawnSync(
  process.execPath,
  [resolve(outDir, 'scripts/physicsRegression.js')],
  { cwd: root, stdio: 'inherit' },
)

rmSync(outDir, { recursive: true, force: true })
process.exit(run.status ?? 1)
