const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const projectDirectory = path.join(__dirname, '..');
const outputDirectory = path.join(projectDirectory, 'dist');
fs.mkdirSync(outputDirectory, { recursive: true });

const staticPages = fs.readdirSync(projectDirectory)
  .filter((name) => /\.(?:html|css)$/i.test(name));
const browserScripts = [
  'account.js',
  'admin.js',
  'features.js',
  'page-shell.js',
  'portfolio-api.js',
  'script.js',
];

for (const name of [...staticPages, ...browserScripts]) {
  fs.copyFileSync(path.join(projectDirectory, name), path.join(outputDirectory, name));
}

for (const directory of ['assets', 'myimages']) {
  fs.cpSync(path.join(projectDirectory, directory), path.join(outputDirectory, directory), { recursive: true });
}

const configuredApiBaseUrl = (process.env.PORTFOLIO_API_BASE_URL || '').trim();
if (configuredApiBaseUrl) {
  let apiBaseUrl;
  try {
    apiBaseUrl = new URL(configuredApiBaseUrl);
  } catch {
    throw new Error('PORTFOLIO_API_BASE_URL must be an HTTPS origin without a path.');
  }
  if (apiBaseUrl.protocol !== 'https:' || apiBaseUrl.origin !== configuredApiBaseUrl) {
    throw new Error('PORTFOLIO_API_BASE_URL must be an HTTPS origin without a path.');
  }
}
fs.writeFileSync(
  path.join(outputDirectory, 'portfolio-api-config.js'),
  `window.PORTFOLIO_API_BASE_URL = ${JSON.stringify(configuredApiBaseUrl)};\n`,
);

const chartOutput = path.join(outputDirectory, 'vendor', 'chart.js');
fs.mkdirSync(path.dirname(chartOutput), { recursive: true });
fs.copyFileSync(
  path.join(projectDirectory, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
  chartOutput,
);

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'blob-upload-entry.js')],
  outfile: path.join(outputDirectory, 'blob-upload.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
});
