import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('a linked backend supplies Architecture for the open frontend workspace', async () => {
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
    await writeFile(join(frontend,'README.md'),'Frontend');
    await mkdir(backend);
    await writeFile(join(backend,'composer.json'),JSON.stringify({require:{'laravel/framework':'*'}}));
    await writeFile(join(backend,'artisan'),'<?php');
    await mkdir(join(backend,'routes'));
    await writeFile(join(backend,'routes','api.php'),'<?php // Backend routes');
    await writeFile(join(backend,'README.md'),'Backend');
    await writeFile(join(backend,'.env'),'FIXTURE=hidden');
    await call('link-backend',{folder:backend},409);
    await call('open',{folder:frontend});
    await call('architecture-status',{},409);
    await call('link-backend',{folder:frontend},400);
    const linked = (await call('link-backend',{folder:backend})).workspace;
    assert.equal(linked.name,'frontend');
    assert.equal(linked.canPreview,true);
    assert.equal(linked.backend.name,'backend');
    assert.equal(linked.architecture,true);
    await call('architecture-status');
    assert.deepEqual((await call('explorer-files',{side:'frontend'})).files,['README.md','package.json','src/App.vue']);
    assert.deepEqual((await call('explorer-files',{side:'backend'})).files,['README.md','artisan','composer.json','routes/api.php']);
    assert.equal((await call('explorer-read',{side:'frontend',file:'README.md'})).text,'Frontend');
    assert.equal((await call('explorer-read',{side:'backend',file:'README.md'})).text,'Backend');
    const phpFile = await call('explorer-read',{side:'backend',file:'routes/api.php'});
    const saved = await call('explorer-write',{side:'backend',file:phpFile.file,hash:phpFile.hash,text:'<?php // Edited routes'});
    assert.equal(saved.text,'<?php // Edited routes');
    assert.equal(await readFile(join(backend,phpFile.file),'utf8'),saved.text);
    await call('explorer-write',{side:'backend',file:phpFile.file,hash:phpFile.hash,text:'<?php // Stale save'},409);
    await call('explorer-write',{side:'backend',file:'../frontend/README.md',hash:saved.hash,text:'Wrong folder'},400);
    await call('explorer-read',{side:'backend',file:'../frontend/README.md'},400);
    await call('explorer-read',{side:'backend',file:'.env'},400);
    assert.equal((await call('read',{file:'src/App.vue'})).text,'<template>Frontend</template>');
    await call('link-backend',{folder:frontend},400);
    assert.equal((await call('status')).workspace.backend.name,'backend');
    assert.equal((await call('unlink-backend')).workspace.backend,undefined);
    await call('explorer-files',{side:'backend'},409);
    await call('architecture-status',{},409);
    await call('link-backend',{folder:backend});
    await call('close');
    const reopened = (await call('open',{folder:frontend})).workspace;
    assert.equal(reopened.backend.folder,linked.backend.folder);
    await call('architecture-status');
  } finally {
    await desktop.stop();
    await rm(root,{recursive:true,force:true});
  }
});
