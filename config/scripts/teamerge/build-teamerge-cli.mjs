import { chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '../../..')
const outfile = resolve(root, 'out/teamerge/teamerge.cjs')

// Standalone bundle: agents call `teamerge` from any worktree without the app's runtime.
await build({
  entryPoints: [resolve(root, 'src/main/teamerge/cli/teamerge-cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Bundle workspace packages from source so the CLI needs no prior package build.
  conditions: ['orca-source'],
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning'
})
chmodSync(outfile, 0o755)
console.log(`built ${outfile}`)
