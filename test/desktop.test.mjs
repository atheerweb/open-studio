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
