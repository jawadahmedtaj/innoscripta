import path from 'node:path';
import { rspack } from '@rspack/core';

const names = ['shell', 'people', 'delivery'];
const aliases = Object.fromEntries(['contracts', 'domain', 'data', 'platform'].map(name =>
  [`@baseline/${name}`, path.resolve(`packages/${name}/src/index.ts`)]));

export default names.map(name => ({
  name,
  mode: 'production',
  entry: `./apps/${name}/src/entry.ts`,
  output: {
    path: path.resolve(`dist/${name}`), filename: '[name].[contenthash].js',
    chunkFilename: '[name].[contenthash].js', publicPath: 'auto', uniqueName: `baseline_${name}`, clean: true
  },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: aliases },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, loader: 'builtin:swc-loader', options: {
      jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }
    } },
    { test: /\.css$/, type: 'css' }
  ] },
  plugins: [
    new rspack.container.ModuleFederationPluginV1({
      name, filename: 'remoteEntry.js', library: { type: 'var', name },
      ...(name === 'shell' ? {} : { exposes: { './App': `./apps/${name}/src/App.tsx` } }),
      shared: Object.fromEntries(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'].map(pkg =>
        [pkg, { singleton: true, strictVersion: true, requiredVersion: '19.3.0' }]))
    }),
    new rspack.HtmlRspackPlugin({
      title: `Baseline · ${name[0].toUpperCase()}${name.slice(1)}`,
      templateContent: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baseline · ${name}</title></head><body><div id="root"></div></body></html>`
    })
  ],
  devtool: 'source-map',
  optimization: { runtimeChunk: false },
  performance: { hints: false }
}));
