import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/minecraft_3d_skin_layers.js',
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
  logLevel: 'info',
});
