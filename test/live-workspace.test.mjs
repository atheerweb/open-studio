import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStudio } from '../server/studio.mjs';

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
    await call('close');
    assert.match(await readFile(join(source,file),'utf8'),/Accepted/);
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve=>app.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
