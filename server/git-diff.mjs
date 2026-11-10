import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { safeFile } from './draft-publish.mjs';

const exec = promisify(execFile);
const diffOptions = ['diff','--no-color','--no-ext-diff','--no-textconv','--relative','--ignore-submodules=dirty'];

async function runGitDiff(cwd,...args) {
  const env = {...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',LC_ALL:'C'};
  return (await exec('git',['--literal-pathspecs','-c','core.fsmonitor=false',...args],{
    cwd,env,windowsHide:true,timeout:10000,maxBuffer:4 * 1024 * 1024
  })).stdout;
}

export function readStagedPatch(cwd) {
  return runGitDiff(cwd,...diffOptions,'--cached','--patch','--unified=2','--','.');
}

export async function readCommitDiff(cwd,{base,head},path) {
  if (path !== undefined) {
    return {patch:await runGitDiff(cwd,...diffOptions,'--no-renames','--patch',base,head,'--',path)};
  }
  return changedFiles(await runGitDiff(cwd,...diffOptions,'--no-renames','--name-status','-z',base,head,'--','.'));
}

function changedFiles(output) {
  const fields = output.split('\0');
  const files = [];
  for (let index = 0; fields[index];) {
    const status = fields[index++][0];
    const path = fields[index++];
    files.push(status === 'R' || status === 'C'
      ? {status,previousPath:path,path:fields[index++]}
      : {status,path});
  }
  return files;
}

export async function readGitDiff(cwd,selection) {
  const run = (...args) => runGitDiff(cwd,...args);

  try {
    if ((await run('rev-parse','--is-inside-work-tree')).trim() !== 'true') return {available:false};
  } catch (error) {
    if (error.code === 'ENOENT') return {available:false,reason:'Git is unavailable.'};
    if (error.stderr?.includes('not a git repository')) return {available:false};
    throw error;
  }

  // Reading a worktree can otherwise execute its configured clean filters.
  const filters = await run('config','--null','--name-only','--get-regexp','^filter\\..*\\.(clean|process|required)$')
    .catch(error => {
      if (error.code === 1 && !error.stderr) return '';
      throw error;
    });
  const overrides = [...new Set(filters.split('\0').filter(Boolean))].flatMap(key =>
    ['-c',key + (key.endsWith('.required') ? '=false' : '=')]);
  const listUntracked = async (path = '.') =>
    (await run('ls-files','--others','--exclude-standard','-z','--',path)).split('\0').filter(Boolean);
  if (selection) {
    const {group,path,previousPath} = selection;
    if (group === 'untracked') {
      if (!(await listUntracked(path)).includes(path)) return {patch:'',message:'This file is no longer untracked.'};
      const file = await safeFile(cwd,path);
      if ((await lstat(file)).size > 524288) return {patch:'',message:'This file is too large to preview.'};
      const contents = await readFile(file);
      if (contents.includes(0)) return {patch:'',message:'Binary file.'};
      return {text:contents.toString('utf8')};
    }
    const index = group === 'staged' ? ['--cached'] : [];
    return {patch:await run(...overrides,...diffOptions,...index,'--patch','--',...(previousPath ? [previousPath,path] : [path]))};
  }
  const [staged,unstaged,untracked] = await Promise.all([
    run(...overrides,...diffOptions,'--cached','--name-status','-z','--','.'),
    run(...overrides,...diffOptions,'--name-status','-z','--','.'),
    listUntracked()
  ]);
  const unstagedFiles = changedFiles(unstaged);
  const conflicts = new Set(unstagedFiles.filter(file=>file.status === 'U').map(file=>file.path));
  return {available:true,staged:changedFiles(staged),
    unstaged:unstagedFiles.filter(file=>file.status === 'U' || !conflicts.has(file.path)),untracked};
}
