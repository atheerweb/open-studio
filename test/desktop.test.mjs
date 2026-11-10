import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('desktop server opens a local Vue workspace and stops listening on quit', async () => {
  const {startDesktopServer} = await import('../desktop/server.mjs');
  const root = await mkdtemp(join(tmpdir(),'open-studio-desktop-'));
  const desktop = await startDesktopServer({store:join(root,'drafts'),pickFolder:async () => root});
  const call = async (action, options) => {
    const response = await fetch(desktop.url + 'api/vue',{
      method:'POST',
      headers:{Origin:new URL(desktop.url).origin,'Content-Type':'application/json'},
      body:JSON.stringify({action,...options})
    });
    assert.equal(response.status,200);
    return response.json();
  };
  try {
    await mkdir(join(root,'src'));
    await writeFile(join(root,'src','App.vue'),'<template>Desktop</template>');
    const {folder} = await call('pick-folder');
    assert.equal(folder,root);
    assert.deepEqual((await call('open',{folder})).workspace.files,['src/App.vue']);
    await desktop.stop();
    await assert.rejects(fetch(desktop.url));
  } finally {
    await desktop.stop();
    await rm(root,{recursive:true,force:true});
  }
});

test('frontend and backend windows keep separate projects open', async () => {
  const {startDesktopServer} = await import('../desktop/server.mjs');
  const root = await mkdtemp(join(tmpdir(),'open-studio-full-stack-'));
  const frontend = join(root,'frontend');
  const backend = join(root,'backend');
  const desktop = await startDesktopServer({store:join(root,'drafts')});
  const call = async (action, options, expected = 200) => {
    const response = await fetch(desktop.url + 'api/vue',{
      method:'POST',
      headers:{Origin:new URL(desktop.url).origin,'Content-Type':'application/json'},
      body:JSON.stringify({action,...options})
    });
    const body = await response.json();
    assert.equal(response.status,expected,body.error);
    return body;
  };
  try {
    await mkdir(join(frontend,'src'),{recursive:true});
    await writeFile(join(frontend,'src','App.vue'),'<template>Frontend</template>');
    await writeFile(join(frontend,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},scripts:{dev:'vite'}}));
    await mkdir(backend);
    await writeFile(join(backend,'composer.json'),JSON.stringify({require:{'laravel/framework':'*'}}));
    await writeFile(join(backend,'artisan'),'<?php');
    await call('open',{folder:frontend});
    await call('open',{workspace:'backend',folder:frontend},409);
    const opened = await call('open',{workspace:'backend',folder:backend});
    assert.equal(opened.workspace.name,'backend');
    assert.equal(opened.workspace.architecture,true);
    await call('architecture-status',{workspace:'backend'});
    await call('architecture-status',{},409);
    assert.equal((await call('status')).workspace.canPreview,true);
    assert.equal((await call('read',{file:'src/App.vue'})).text,'<template>Frontend</template>');
    await call('close',{workspace:'backend'});
    assert.equal((await call('status',{workspace:'backend'})).workspace,null);
    assert.equal((await call('status')).workspace.name,'frontend');
  } finally {
    await desktop.stop();
    await rm(root,{recursive:true,force:true});
  }
});
