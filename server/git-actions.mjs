import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readGitDiff } from './git-diff.mjs';

const exec = promisify(execFile);
const fail = (message,status = 400) => Object.assign(new Error(message),{status});

async function git(cwd,...args) {
  const pushing = args.includes('push');
  try {
    const {stdout} = await exec('git',['--literal-pathspecs',...args],{
      cwd,windowsHide:true,timeout:pushing ? 120000 : 30000,maxBuffer:4 * 1024 * 1024,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',LC_ALL:'C'}
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('Git is unavailable.',422);
    const details = error.stderr?.trim().replace(/(https?:\/\/)[^\s/@]+@/gi,'$1');
    throw fail(details || (error.killed ? 'Git timed out.' : 'Git could not complete the action.'),422);
  }
}

async function branchInfo(root) {
  const branch = await git(root,'branch','--show-current');
  const [remote = '',ref = '',upstream = ''] = branch
    ? (await git(root,'for-each-ref','--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short)',
      'refs/heads/' + branch)).split('\0') : [];
  return {branch,remote,ref,upstream};
}

export async function gitWorkspace(source) {
  const available = await git(source,'rev-parse','--is-inside-work-tree').catch(error => {
    if (error.message.includes('not a git repository')) return 'false';
    if (error.message === 'Git is unavailable.') return null;
    throw error;
  });
  return available === 'true' ? {root:await git(source,'rev-parse','--show-toplevel')}
    : {result:{available:false,...(available === null && {reason:'Git is unavailable.'})}};
}

export async function readGitWorkspace(source) {
  const {root,result} = await gitWorkspace(source);
  if (!root) return result;
  const [diff,{branch,upstream},remotes] = await Promise.all([readGitDiff(root),branchInfo(root),git(root,'remote')]);
  return {...diff,branch,upstream,hasRemote:Boolean(remotes)};
}

export async function changeGitWorkspace(source,{action,group,path,message}) {
  const {root} = await gitWorkspace(source);
  if (!root) throw fail('Open a Git working tree first.');
  if (action === 'git-push') {
    const {branch,remote,ref} = await branchInfo(root);
    if (!branch) throw fail('Check out a branch before pushing.');
    const options = ['-c','push.followTags=false','-c','remote.' + remote + '.mirror=false'];
    if (remote && ref) {
      if (remote === '.') throw fail('The upstream is a local branch. Configure a remote upstream before pushing.');
      await git(root,...options,'push','--',remote,'refs/heads/' + branch + ':' + ref);
    } else {
      const remotes = (await git(root,'remote')).split('\n').filter(Boolean);
      const target = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
      if (!target) throw fail(remotes.length ? 'Configure an upstream for this branch before pushing.' : 'Add a Git remote before pushing.');
      await git(root,'-c','push.followTags=false','-c','remote.' + target + '.mirror=false',
        'push','--set-upstream','--',target,'refs/heads/' + branch + ':refs/heads/' + branch);
    }
    return;
  }
  if (action === 'git-commit') {
    if (typeof message !== 'string' || !message.trim() || message.includes('\0') || message.length > 8000) {
      throw fail('Enter a commit message between 1 and 8,000 characters.');
    }
    await git(root,'commit','-m',message.trim());
    return;
  }
  const unstage = action === 'git-unstage';
  if (!(unstage ? group === 'staged' : ['unstaged','untracked'].includes(group))) {
    throw fail('Choose a changed project file.');
  }
  const changes = await readGitDiff(root);
  const file = group === 'untracked' ? changes.untracked.find(item => item === path) : changes[group].find(item => item.path === path);
  if (!file) throw fail('Choose a changed project file.');
  const paths = [path];
  if (file.status === 'R') paths.push(file.previousPath);
  if (!unstage) await git(root,'add','-A','--',...paths);
  else if (await git(root,'rev-parse','--verify','--quiet','HEAD').catch(() => '')) {
    await git(root,'reset','-q','HEAD','--',...paths);
  } else {
    await git(root,'rm','--cached','-f','--',...paths);
  }
}
