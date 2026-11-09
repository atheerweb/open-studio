import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const rootFile = /^(package(-lock)?\.json|AGENTS\.md|index\.html|vite\.config\.[cm]?[jt]s|[jt]sconfig[^\\/]*\.json|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|\.env(?:\.[a-z0-9_-]+)*)$/i;
export const projectFolders = new Set(['src','public','test','tests','docs']);
export const bridgeFile = 'public/__open_studio_route__.js';
export const bridgeTag = '<script defer src="/__open_studio_route__.js"></script>\n';
const excluded = new Set(['.git','.vite','.vite-temp','.cache','node_modules']);
export const fingerprint = value => createHash('sha256').update(value).digest('hex');
const digest = value => value === null ? null : fingerprint(value);

export async function safeFile(root,file) {
  const parts = file.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part) ||
      (process.platform === 'win32' && (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))) {
    throw new Error('Invalid project path.');
  }
  let path = root;
  for (const [index,part] of parts.entries()) {
    path = join(path,part);
    const info = await lstat(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && !(index === parts.length - 1 ? info.isFile() : info.isDirectory())) {
      throw new Error('Expected a regular project path: ' + file);
    }
  }
  return path;
}

async function contents(root,file) {
  const path = await safeFile(root,file);
  return readFile(path).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
}

export function editableFile(file) {
  if (typeof file !== 'string' || file.toLowerCase() === bridgeFile) return false;
  const parts = file.split('/');
  return parts.every(part => !excluded.has(part.toLowerCase()) && !/^\.env(?:\.|$)/i.test(part)) &&
    (parts.length > 1 ? projectFolders.has(parts[0]) : rootFile.test(file));
}

async function draftContents(draft,file) {
  const data = await contents(draft.directory,file);
  return data && file === 'index.html' && draft.bridgeOrigin
    ? Buffer.from(data.toString('utf8').replace(bridgeTag,'')) : data;
}

export async function projectFiles(root, prefix = '') {
  const entries = await readdir(join(root,prefix),{withFileTypes:true});
  const result = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const file = prefix ? prefix + '/' + entry.name : entry.name;
    if (file === bridgeFile) continue;
    if (entry.isDirectory() && (prefix || projectFolders.has(file))) result.push(...await projectFiles(root,file));
    else if (entry.isFile() && (prefix || rootFile.test(file))) result.push(file);
  }
  return result.sort();
}

export async function atomicWrite(path,data) {
  const temporary = path + '.open-studio-' + randomUUID();
  await mkdir(dirname(path),{recursive:true});
  try {
    await writeFile(temporary,data,{flag:'wx'});
    await rename(temporary,path);
  } finally {
    await rm(temporary,{force:true});
  }
}

export async function recordBaseline(directory) {
  const files = await projectFiles(directory);
  return Object.fromEntries(await Promise.all(files.map(async file => [file,digest(await contents(directory,file))])));
}

function display(data) {
  if (!data) return null;
  const text = data.toString('utf8');
  return data.length <= 524288 && !text.includes('\0') && Buffer.from(text).equals(data) ? text : undefined;
}

async function collect(draft) {
  const files = new Set([...Object.keys(draft.projectBaseline),...await projectFiles(draft.directory)]);
  const changes = [];
  for (const file of [...files].sort()) {
    const next = await draftContents(draft,file);
    const nextHash = digest(next);
    const baseline = Object.hasOwn(draft.projectBaseline,file) ? draft.projectBaseline[file] : null;
    if (nextHash === baseline) continue;
    const original = await contents(draft.source,file);
    const originalHash = digest(original);
    changes.push({file,next,original,nextHash,originalHash,conflict:originalHash !== baseline});
  }
  const token = fingerprint(JSON.stringify(changes.map(({file,nextHash,originalHash,conflict}) =>
    [file,nextHash,originalHash,conflict])));
  return {changes,token};
}

export async function reviewDraft(draft) {
  const {changes,token} = await collect(draft);
  return {token,changes:changes.map(({file,next,original,originalHash,conflict}) => {
    const before = display(original);
    const after = display(next);
    return {file,before,after,originalHash,conflict,binary:before === undefined || after === undefined,
      kind:next === null ? 'Deleted' : original === null ? 'Added' : 'Modified'};
  })};
}

export async function publishDraft(draft,reviewToken) {
  const {changes,token} = await collect(draft);
  const conflicts = changes.filter(change => change.conflict).map(change => change.file);
  if (conflicts.length) throw new Error('Resolve publishing conflicts in: ' + conflicts.join(', '));
  if (token !== reviewToken) throw new Error('The changes have moved since review. Open the diff again.');
  const applied = [];
  try {
    for (const change of changes) {
      if (digest(await contents(draft.source,change.file)) !== change.originalHash) {
        throw new Error('Publishing conflict in ' + change.file);
      }
      const path = await safeFile(draft.source,change.file);
      if (change.next === null) await rm(path);
      else await atomicWrite(path,change.next);
      applied.push(change);
    }
    const baseline = {...draft.projectBaseline};
    for (const {file,nextHash} of changes) baseline[file] = nextHash;
    await draft.updateBaseline(baseline);
  } catch (error) {
    const failed = [];
    for (const change of applied.reverse()) {
      try {
        if (digest(await contents(draft.source,change.file)) !== change.nextHash) throw new Error('File changed');
        const path = await safeFile(draft.source,change.file);
        if (change.original === null) await rm(path);
        else await atomicWrite(path,change.original);
      } catch {
        failed.push(change.file);
      }
    }
    if (failed.length) throw new Error(error.message + '. Could not roll back: ' + failed.join(', '));
    throw error;
  }
}

export async function resolveDraftConflict(draft,file,expectedHash,merged,keepOriginal) {
  const {changes} = await collect(draft);
  const change = changes.find(change => change.file === file && change.conflict);
  if (!change || change.originalHash !== expectedHash) throw new Error('Refresh the review before resolving this conflict.');
  if (!keepOriginal && merged !== null && (typeof merged !== 'string' || Buffer.byteLength(merged) > 524288)) {
    throw new Error('Enter merged text up to 512 KiB.');
  }
  const path = await safeFile(draft.directory,file);
  let resolved = keepOriginal ? change.original : merged;
  if (file === 'index.html' && draft.bridgeOrigin) {
    if (resolved === null || !/<\/head\s*>/i.test(resolved.toString())) throw new Error('Keep a closing head tag in index.html.');
    resolved = resolved.toString().replace(/<\/head\s*>/i,bridgeTag + '$&');
  }
  const previous = await contents(draft.directory,file);
  if (resolved === null) await rm(path,{force:true});
  else await atomicWrite(path,resolved);
  try {
    await draft.updateBaseline({...draft.projectBaseline,[file]:expectedHash});
  } catch (error) {
    if (previous === null) await rm(path,{force:true});
    else await atomicWrite(path,previous);
    throw error;
  }
}
