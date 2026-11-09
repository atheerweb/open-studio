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
  const app = createStudio({ask:async () => ({message:'Updated',patch:{find:'Saved',replace:'Accepted'}})});
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
    await call('git-stage',{group:'untracked',path:'src'},400);
    await call('git-stage',{group:'untracked',path:file});
    await call('git-unstage',{group:'staged',path:file});
    assert.deepEqual((await call('git-diff')).staged,[]);
    await call('git-stage',{group:'untracked',path:file});
    await call('git-commit',{message:'Update the page'});
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

test('live preview loads the project Vite config without writing a bridge into the project', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-live-preview-'));
  let workspace;
  try {
    await mkdir(join(root,'node_modules'));
    await symlink(await realpath('node_modules/vite'),join(root,'node_modules','vite'),
      process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},
      scripts:{dev:'node node_modules/vite/bin/vite.js'}}));
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
