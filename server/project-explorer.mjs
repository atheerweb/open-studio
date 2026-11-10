import { isUtf8 } from 'node:buffer';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, bridgeFile, fingerprint, safeFile } from './draft-publish.mjs';

const excluded = new Set(['.git','.cache','.vite','.vite-temp','node_modules','vendor','dist','coverage']);
const maxFiles = 5000;
const maxBytes = 524288;
const error = (status,message) => Object.assign(new Error(message),{status});

function visibleName(name) {
  return name && name !== '.' && name !== '..' && !/[\\:\x00-\x1f]/.test(name) &&
    !excluded.has(name.toLowerCase()) && (!/^\.env(?:\.|$)/i.test(name) || /^\.env\.example$/i.test(name));
}

export async function listExplorerFiles(root) {
  const files = [];
  async function visit(folder,prefix = '') {
    const entries = await readdir(folder,{withFileTypes:true});
    for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
      if (!visibleName(entry.name)) continue;
      const file = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(folder,entry.name),file + '/');
      else if (entry.isFile() && file !== bridgeFile) files.push(file);
      if (files.length > maxFiles) return;
    }
  }
  await visit(root);
  return {files:files.slice(0,maxFiles).sort(),truncated:files.length > maxFiles};
}

const fileVersion = (root,file,text) => fingerprint(JSON.stringify([root,file,text]));

async function readEntry(root,file) {
  if (typeof file !== 'string' || file === bridgeFile || !file.split('/').every(visibleName)) {
    throw error(400,'Choose a file from the project explorer.');
  }
  const path = await safeFile(root,file);
  const info = await lstat(path);
  if (info.size > maxBytes) throw error(413,'File preview is limited to 512 KiB.');
  const data = await readFile(path);
  if (data.length > maxBytes) throw error(413,'File preview is limited to 512 KiB.');
  if (data.includes(0) || !isUtf8(data)) throw error(415,'Explorer previews UTF-8 text files.');
  return {path,mode:info.mode & 0o777,text:data.toString('utf8')};
}

export async function readExplorerFile(root,file) {
  const {text} = await readEntry(root,file);
  return {file,text,hash:fileVersion(root,file,text)};
}

export async function writeExplorerFile(root,file,hash,text) {
  if (typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > maxBytes) {
    throw error(400,'Save UTF-8 text files up to 512 KiB.');
  }
  const current = await readEntry(root,file);
  if (fileVersion(root,file,current.text) !== hash) throw error(409,'This file changed. Reopen it before saving.');
  if (current.text !== text) await atomicWrite(current.path,text,current.mode);
  return {file,text,hash:fileVersion(root,file,text)};
}
