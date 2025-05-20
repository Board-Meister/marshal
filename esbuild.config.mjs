import * as esbuild from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url';
import clear from "esbuild-plugin-output-reset";
import { globSync } from 'glob'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await esbuild.build({
  entryPoints: [
    resolve(__dirname, 'index.tsx'),
  ],
  bundle: true,
  minify: true,
  format: 'esm',
  outdir: './dist',
  platform: 'browser',
  loader: {'.js': 'jsx'},
  mainFields: ['module', 'main'],
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  plugins: [clear],
})

await esbuild.build({
  entryPoints: [
    ...globSync(resolve(__dirname, 'test/**/*.ts')),
  ],
  bundle: true,
  minify: false,
  format: 'esm',
  outdir: './dist-test',
  platform: 'browser',
  loader: {'.js': 'jsx'},
  mainFields: ['module', 'main'],
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  plugins: [
    clear,
  ],
})