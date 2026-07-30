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
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning'
})
chmodSync(outfile, 0o755)
console.log(`built ${outfile}`)
