const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: ['src/service-worker/service-worker.ts'],
  bundle: true,
  outfile: 'dist/browser/service-worker.js',
  target: 'chrome114',
  format: 'iife', // Service workers run in an isolated JS context
  platform: 'browser',
  external: [],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  minify: true,
  loader: {
    '.ts': 'ts',
  },
}).then(() => {
  console.log('✅ Service worker built');
}).catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
