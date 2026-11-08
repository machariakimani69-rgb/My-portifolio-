const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const outputDirectory = path.join(__dirname, '..', 'dist');
fs.mkdirSync(outputDirectory, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'blob-upload-entry.js')],
  outfile: path.join(outputDirectory, 'blob-upload.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
});
