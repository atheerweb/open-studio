import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startDesktopServer } from '../desktop/server.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'open-studio-saved-')));
  const store = join(root,'drafts');
  const frontend = join(root,'frontend');
  const backend = join(root,'backend');
  const other = join(root,'other');
  let desktop;
  t.after(async () => {
    await desktop?.stop();
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(frontend,'src'),{recursive:true});
  await writeFile(join(frontend,'src','App.vue'),'<template>Frontend</template>');
  await mkdir(backend);
  await writeFile(join(backend,'composer.json'),JSON.stringify({require:{'laravel/framework':'*'}}));
  await writeFile(join(backend,'artisan'),'<?php');
  await mkdir(other);
  const stop = () => desktop?.stop();
  const restart = async () => {
    await stop();
    desktop = await startDesktopServer({store});
  };
  const call = async (action,options,expected = 200) => {
    const response = await fetch(desktop.url + 'api/vue',{
      method:'POST',
      headers:{Origin:new URL(desktop.url).origin,'Content-Type':'application/json'},
      body:JSON.stringify({action,...options})
    });
    const body = await response.json();
    assert.equal(response.status,expected,body.error);
    return body;
  };
  await restart();
  return {frontend,backend,other,restart,stop,call};
}

test('desktop relaunch restores the active project, linked backend, and chat session', async t => {
  const {frontend,backend,restart,call} = await fixture(t);
  await call('open',{folder:frontend});
  await call('link-backend',{folder:backend});
  const {workspace:before} = await call('agent-session',{sessionId:null});

  await restart();

  const {workspace,savedWorkspaces} = await call('status');
  assert.equal(workspace?.name,'frontend');
  assert.equal(workspace.backend.name,'backend');
  assert.equal(workspace.activeSessionId,before.activeSessionId);
  assert.deepEqual(workspace.files,['src/App.vue']);
  assert.equal(workspace.url,undefined);
  assert.deepEqual(savedWorkspaces,[{name:'frontend',folder:frontend}]);
  await call('architecture-status');
});

test('desktop can switch saved projects and explicitly closing keeps the saved list', async t => {
  const {frontend,backend,other,restart,call} = await fixture(t);
  await call('open',{folder:frontend});
  await call('link-backend',{folder:backend});
  await call('open',{folder:other,replace:true});
  await call('open',{folder:other + '-missing',replace:true},422);
  assert.equal((await call('status')).workspace.name,'other');
  const {workspace} = await call('open',{folder:frontend,replace:true});
  assert.equal(workspace.backend.name,'backend');
  await call('unlink-backend');
  await call('close');

  await restart();

  const status = await call('status');
  assert.equal(status.workspace,null);
  assert.deepEqual(status.savedWorkspaces,[{name:'frontend',folder:frontend},{name:'other',folder:other}]);
  assert.equal((await call('open',{folder:frontend})).workspace.backend,undefined);
});

test('desktop still opens when a saved project or its backend has moved', async t => {
  const {frontend,backend,other,restart,stop,call} = await fixture(t);
  await call('open',{folder:frontend});
  await call('link-backend',{folder:backend});
  await stop();
  await rename(backend,backend + '-moved');
  await restart();
  const partial = await call('status');
  assert.equal(partial.workspace?.name,'frontend');
  assert.equal(partial.workspace.backend,undefined);
  assert.match(partial.workspaceWarning,/backend/i);

  await stop();
  await rename(frontend,frontend + '-moved');
  await restart();
  const missing = await call('status');
  assert.equal(missing.workspace,null);
  assert.match(missing.workspaceWarning,/frontend/i);
  assert.equal((await call('open',{folder:other})).workspace.name,'other');
});
