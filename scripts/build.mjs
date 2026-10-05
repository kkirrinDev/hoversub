import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const config = {
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/options.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'firefox140',
  legalComments: 'none', sourcemap: false, logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('Watching TypeScript. Restart dev to copy changed public files.');
} else await build(config);
