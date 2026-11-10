import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStudio } from '../server/studio.mjs';
import { LiveWorkspace } from '../server/live-workspace.mjs';

test('opens the working tree, stages selected changes, commits and pushes the current branch', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-live-'));
  const source = join(root,'repo');
  const remote = join(root,'remote.git');
  const file = 'src/App.vue';
  const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
  const commitRequests = [];
  const app = createStudio({ask:async (prompt,input,options) => {
    if (input.source) return {message:'Updated',patch:{find:'Saved',replace:'Accepted'}};
    commitRequests.push({input,options});
    return {message:'  Update the page  ',patch:null};
  }});
  try {
    await mkdir(join(source,'src'),{recursive:true});
    await writeFile(join(source,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},scripts:{dev:'vite'}}));
    await writeFile(join(source,file),'<template>Before</template>');
    git(source,'init','-b','main');
    git(source,'config','user.name','Studio Test');
    git(source,'config','user.email','studio@example.test');
    git(root,'init','--bare',remote);
    git(source,'remote','add','origin',remote);
    await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:' + app.address().port;
    async function call(action,input = {},status = 200) {
      const response = await fetch(origin+'/api/vue',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
        body:JSON.stringify({action,...input})});
      const result = await response.json();
      assert.equal(response.status,status,JSON.stringify(result));
      return result;
    }
    assert.equal((await call('open',{folder:source})).workspace.live,true);
    const {hash} = await call('read',{file});
    await call('write',{file,hash,text:'<template>Saved</template>'});
    assert.match(await readFile(join(source,file),'utf8'),/Saved/);
    await call('chat',{route:'/',file,prompt:'Update the page',approved:true});
    assert.match(await readFile(join(source,file),'utf8'),/Accepted/);
    await call('git-commit',{message:'   '},400);
    await call('git-generate-message',{},403);
    await call('git-generate-message',{approved:true},400);
    assert.equal(commitRequests.length,0);
    await call('git-stage',{group:'untracked',path:'src'},400);
    await call('git-stage',{group:'untracked',path:file});
    await call('git-unstage',{group:'staged',path:file});
    assert.deepEqual((await call('git-diff')).staged,[]);
    await call('git-stage-all');
    assert.deepEqual((await call('git-diff')).staged.map(change=>change.path),['package.json',file]);
    await call('git-unstage-all');
    assert.deepEqual((await call('git-diff')).staged,[]);
    await call('git-stage',{group:'untracked',path:file});
    await writeFile(join(source,file),'<template>Unstaged draft</template>');
    const suggestion = await call('git-generate-message',{approved:true});
    assert.deepEqual(suggestion,{message:'Update the page'});
    assert.equal(commitRequests.length,1);
    assert.equal(commitRequests[0].options?.disableTools,true);
    assert.match(commitRequests[0].input.patch,/Accepted/);
    assert.doesNotMatch(commitRequests[0].input.patch,/Unstaged draft|package\.json/);
    assert.equal(git(source,'status','--short'),['AM '+file,'?? package.json'].join('\n'));
    await call('git-discard',{group:'unstaged',path:file},403);
    await call('git-discard',{group:'staged',path:file,approved:true},400);
    assert.match((await call('read',{file})).text,/Unstaged draft/);
    await call('git-discard',{group:'unstaged',path:file,approved:true});
    assert.equal((await call('read',{file})).text,'<template>Accepted</template>');
    assert.equal(git(source,'status','--short'),['A  '+file,'?? package.json'].join('\n'));

    const scratch = 'src/scratch[1].vue';
    await writeFile(join(source,scratch),'<template>Scratch</template>');
    await writeFile(join(source,'src/scratch1.vue'),'<template>Keep</template>');
    await call('git-discard',{group:'untracked',path:'src',approved:true},400);
    const discarded = await call('git-discard',{group:'untracked',path:scratch,approved:true});
    assert.ok(!discarded.workspace.files.includes(scratch));
    await assert.rejects(readFile(join(source,scratch)),{code:'ENOENT'});
    assert.match(await readFile(join(source,'src/scratch1.vue'),'utf8'),/Keep/);
    await rm(join(source,'src/scratch1.vue'));

    await call('git-commit',suggestion);
    assert.match(git(source,'show','HEAD:'+file),/Accepted/);
    assert.equal(git(source,'status','--short'),'?? package.json');
    await call('git-push');
    assert.equal(git(remote,'rev-parse','refs/heads/main'),git(source,'rev-parse','HEAD'));
    await call('git-stage',{group:'untracked',path:'package.json'});
    await call('git-commit-and-push',{message:'Add package metadata'});
    assert.equal(git(remote,'rev-parse','refs/heads/main'),git(source,'rev-parse','HEAD'));
    git(source,'remote','set-url','origin',join(root,'missing.git'));
    await writeFile(join(source,file),'<template>After failed push</template>');
    await call('git-stage',{group:'unstaged',path:file});
    const failed = await call('git-commit-and-push',{message:'Keep local commit'},422);
    assert.equal(failed.committed,true);
    assert.equal(failed.rejectedPushBranch,undefined);
    assert.match(failed.error,/Commit created\. Push failed/);
    assert.equal(git(source,'log','-1','--format=%s'),'Keep local commit');
    await call('close');
    assert.match(await readFile(join(source,file),'utf8'),/After failed push/);
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve=>app.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test('switches branches, pulls fast-forwards, and recovers a rejected push while undoing a committed file', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-branches-'));
  const source = join(root,'repo');
  const remote = join(root,'remote.git');
  const writer = join(root,'writer');
  const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
  const app = createStudio();
  try {
    git(root,'init','--bare','-b','main',remote);
    git(root,'clone',remote,writer);
    git(writer,'config','user.name','Studio Test');
    git(writer,'config','user.email','studio@example.test');
    await mkdir(join(writer,'src'));
    await writeFile(join(writer,'src/App.vue'),'<template>Main</template>');
    git(writer,'add','.');
    git(writer,'commit','-m','Initial component');
    git(writer,'push','origin','main');
    git(writer,'switch','-c','feature/preview');
    await writeFile(join(writer,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},scripts:{dev:'vite'}}));
    await writeFile(join(writer,'src/Preview.vue'),'<template>Feature</template>');
    git(writer,'add','.');
    git(writer,'commit','-m','Add feature component');
    git(writer,'push','origin','feature/preview');
    git(root,'clone',remote,source);
    await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:' + app.address().port;
    async function call(action,input = {},status = 200) {
      const response = await fetch(origin+'/api/vue',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
        body:JSON.stringify({action,...input})});
      const result = await response.json();
      assert.equal(response.status,status,JSON.stringify(result));
      return result;
    }
    await call('open',{folder:source});
    assert.deepEqual((await call('git-diff')).branches,{
      local:['main'],remote:['origin/feature/preview','origin/main']
    });
    await call('git-switch',{ref:'HEAD~1'},400);
    const {workspace} = await call('git-switch',{ref:'refs/remotes/origin/feature/preview'});
    assert.deepEqual(workspace.files,['src/App.vue','src/Preview.vue']);
    assert.equal(workspace.canPreview,true);
    const diff = await call('git-diff');
    assert.equal(diff.branch,'feature/preview');
    assert.equal(diff.upstream,'origin/feature/preview');
    assert.equal(diff.incomingCommits,0);

    await writeFile(join(writer,'src/Preview.vue'),'<template>Remote update</template>');
    git(writer,'commit','-am','Update feature component');
    git(writer,'push','origin','feature/preview');
    const updatedHead = git(writer,'rev-parse','HEAD');
    const updatedAt = git(writer,'log','-1','--format=%cI');
    const fetched = await call('git-fetch');
    assert.equal(fetched.incomingCommits,1);
    assert.equal(fetched.remoteBranchUpdatedAt['origin/feature/preview'],updatedAt);
    assert.equal(fetched.graph[0].hash,updatedHead);
    assert.equal(fetched.graph[0].subject,'Update feature component');
    assert.match(fetched.graph[0].refs,/origin\/feature\/preview/);
    assert.equal((await call('read',{file:'src/Preview.vue'})).text,'<template>Feature</template>');
    await call('git-pull',{branch:'main'},409);
    await call('git-pull',{branch:'feature/preview'});
    assert.equal((await call('read',{file:'src/Preview.vue'})).text,'<template>Remote update</template>');
    assert.equal((await call('git-diff')).incomingCommits,0);

    git(source,'config','user.name','Studio Test');
    git(source,'config','user.email','studio@example.test');
    const unwanted = 'nwc-file';
    await writeFile(join(source,unwanted),'Accidental local file');
    git(source,'add','--',unwanted);
    git(source,'commit','-m','Local commit');
    const localHead = git(source,'rev-parse','HEAD');
    await writeFile(join(writer,'src/Preview.vue'),'<template>Divergent remote update</template>');
    git(writer,'commit','-am','Remote commit');
    const remoteHead = git(writer,'rev-parse','HEAD');
    git(writer,'push','origin','feature/preview');

    const rejected = await call('git-push',{},422);
    assert.equal(rejected.rejectedPushBranch,'feature/preview');
    assert.match(rejected.error,/Merge & Push/);
    await call('git-pull',{branch:'feature/preview'},422);
    assert.equal(git(source,'rev-parse','HEAD'),localHead);
    const {committed,localCommitRange,incomingCommits,graph} = await call('git-diff');
    assert.equal(incomingCommits,1);
    assert.ok(graph.some(row=>row.hash === localHead));
    assert.ok(graph.some(row=>row.hash === remoteHead));
    assert.ok(graph.some(row=>row.lanes.includes('|')));
    assert.deepEqual(committed,[{status:'A',path:unwanted}]);
    const undo = {group:'committed',path:unwanted,localCommitRange};
    assert.match((await call('git-file',undo)).patch,/\+Accidental local file/);
    await call('git-discard',undo,403);
    await writeFile(join(source,unwanted),'Uncommitted edit');
    await call('git-discard',{...undo,approved:true},409);
    assert.equal(await readFile(join(source,unwanted),'utf8'),'Uncommitted edit');
    await call('git-discard',{group:'unstaged',path:unwanted,approved:true});
    await call('git-discard',{...undo,approved:true});
    assert.equal(git(source,'rev-parse','HEAD'),localHead);
    assert.equal(git(source,'status','--short'),'D '+unwanted);
    await call('git-stage',{group:'unstaged',path:unwanted});
    await call('git-commit',{message:'Remove accidental file'});
    assert.deepEqual((await call('git-diff')).committed,[]);

    await call('git-merge-upstream',{branch:'main'},409);
    git(source,'branch','--unset-upstream');
    assert.equal((await call('git-diff')).incomingCommits,null);
    await call('git-merge-and-push',{branch:'main'},409);
    assert.equal(git(remote,'rev-parse','refs/heads/feature/preview'),remoteHead);
    await call('git-merge-and-push',{branch:'feature/preview'});
    git(source,'merge-base','--is-ancestor',localHead,'HEAD');
    git(source,'merge-base','--is-ancestor',remoteHead,'HEAD');
    assert.equal((await call('read',{file:'src/Preview.vue'})).text,'<template>Divergent remote update</template>');
    assert.equal(git(remote,'rev-parse','refs/heads/feature/preview'),git(source,'rev-parse','HEAD'));
    assert.throws(()=>git(remote,'cat-file','-e','refs/heads/feature/preview:'+unwanted));
    assert.equal((await call('git-diff')).upstream,'origin/feature/preview');

    await writeFile(join(source,'src/Preview.vue'),'<template>Local commit for conflict</template>');
    await call('git-merge-and-push',{branch:'feature/preview'},409);
    git(writer,'pull','--ff-only','origin','feature/preview');
    await writeFile(join(writer,'src/Preview.vue'),'<template>Remote commit for conflict</template>');
    git(writer,'commit','-am','Conflicting remote commit');
    git(writer,'push','origin','feature/preview');
    const conflictingRemote = git(writer,'rev-parse','HEAD');
    await call('git-stage',{group:'unstaged',path:'src/Preview.vue'});
    const rejectedCommit = await call('git-commit-and-push',{message:'Conflicting local commit'},422);
    assert.equal(rejectedCommit.committed,true);
    assert.equal(rejectedCommit.rejectedPushBranch,'feature/preview');
    const preMerge = git(source,'rev-parse','HEAD');
    await call('git-merge-and-push',{branch:'feature/preview'},409);
    assert.equal(git(remote,'rev-parse','refs/heads/feature/preview'),conflictingRemote);
    const conflict = await call('git-diff');
    assert.equal(conflict.mergeInProgress,true);
    assert.deepEqual(conflict.unstaged,[{status:'U',path:'src/Preview.vue'}]);
    await call('git-abort-merge',{branch:'feature/preview'},403);
    await call('git-abort-merge',{branch:'feature/preview',approved:true});
    assert.equal((await call('git-diff')).mergeInProgress,false);
    assert.equal(git(source,'rev-parse','HEAD'),preMerge);

    await writeFile(join(source,'src/Preview.vue'),'<template>Local changes</template>');
    await call('git-switch',{ref:'refs/heads/main'},422);
    assert.match(await readFile(join(source,'src/Preview.vue'),'utf8'),/Local changes/);
    git(source,'restore','--','src/Preview.vue');
    const switchedBack = (await call('git-switch',{ref:'refs/heads/main'})).workspace;
    assert.deepEqual(switchedBack.files,['src/App.vue']);
    assert.equal(switchedBack.canPreview,false);
    assert.equal(git(source,'branch','--show-current'),'main');
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve=>app.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test('live preview loads the project Vite config without writing a bridge into the project', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-live-preview-'));
  let workspace;
  try {
    const modules = join(root,'node_modules');
    const vite = join(modules,'vite');
    await mkdir(vite,{recursive:true});
    await symlink(await realpath('node_modules/vite'),join(modules,'vite-runtime'),
      process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(vite,'package.json'),JSON.stringify({main:'./esm.mjs',exports:{
      '.':{import:{default:'./esm.mjs'},require:'./index.cjs'},'./package.json':'./package.json'
    }}));
    await writeFile(join(vite,'index.cjs'),'module.exports = {};');
    await writeFile(join(vite,'esm.mjs'),
      "export {loadConfigFromFile,mergeConfig} from '../vite-runtime/dist/node/index.js';");
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},
      scripts:{dev:'node node_modules/vite-runtime/bin/vite.js'}}));
    const html = '<html><head></head><body>Original</body></html>';
    await writeFile(join(root,'index.html'),html);
    await writeFile(join(root,'vite.config.mjs'),`export default {plugins:[{
      name:'fixture',transformIndexHtml(html) { return html.replace('Original','Configured'); }
    }]};`);
    const files = await readdir(root);
    const portCheck = createServer();
    await new Promise((resolve,reject)=>portCheck.once('error',reject).listen(0,'localhost',resolve));
    const port = portCheck.address().port;
    await new Promise(resolve=>portCheck.close(resolve));
    workspace = await LiveWorkspace.open(root);
    await workspace.installBridge('http://localhost:4320');
    await workspace.start(port).catch(error => { throw new Error(error.message + '\n' + workspace.logs); });
    const page = await (await fetch(workspace.url)).text();
    assert.match(page,/Configured/);
    assert.match(page,/studio-vue-hello/);
    assert.equal(await readFile(join(root,'index.html'),'utf8'),html);
    assert.deepEqual(await readdir(root),files);
  } finally {
    await workspace?.close();
    await rm(root,{recursive:true,force:true});
  }
});
