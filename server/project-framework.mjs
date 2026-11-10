import { posix } from 'node:path';
import { parsers } from 'prettier/plugins/babel';

export function packageManifest(text) {
  try { return JSON.parse(text?.replace(/^\uFEFF/,'')); }
  catch { return null; }
}

export const usesPackage = (manifest,name) => Boolean(manifest?.dependencies?.[name] || manifest?.devDependencies?.[name] ||
  manifest?.peerDependencies?.[name]);

export function frontendFramework(manifest) {
  if (usesPackage(manifest,'vue')) return 'vue';
  if (usesPackage(manifest,'react')) return 'react';
  return null;
}

export const hasViteDevScript = manifest => typeof manifest?.scripts?.dev === 'string' && /\bvite\b/.test(manifest.scripts.dev);
export const scriptExtension = /\.[cm]?[jt]sx?$/i;
export const sourceParser = file => /\.vue$/i.test(file) ? 'vue' : /\.[cm]?tsx?$/i.test(file) ? 'typescript' : 'babel';

export function scriptStatements(file,text) {
  const parser = sourceParser(file) === 'typescript' ? 'babel-ts' : 'babel';
  try { return parsers[parser].parse(text,{}).program.body; }
  catch { return []; }
}

export function resolveScript(from,specifier,files) {
  const path = specifier.startsWith('@/') ? 'src/' + specifier.slice(2)
    : specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(from),specifier)) : null;
  if (!path) return null;
  if (files.has(path)) return path;
  const stem = path.replace(/\.[cm]?jsx?$/i,'');
  for (const extension of ['.ts','.tsx','.js','.jsx','.mts','.cts','.mjs','.cjs']) {
    for (const candidate of [stem + extension,posix.join(path,'index' + extension)]) {
      if (files.has(candidate)) return candidate;
    }
  }
  return null;
}
