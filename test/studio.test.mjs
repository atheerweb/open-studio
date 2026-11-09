import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { askCodex } from '../server/codex.mjs';
import { createStudio } from '../server/studio.mjs';

test('Codex receives a structured prompt in a temporary read-only run', async () => {
  const input = {route:'/dashboard',source:'<h1>Before</h1>'};
  const result = await askCodex('Return a patch.',input,async (args,prompt,cwd) => {
    assert.deepEqual(args.slice(0,5),['--ask-for-approval','never','exec','--sandbox','read-only']);
    assert.ok(args.includes('--ephemeral'));
    assert.equal(args.at(-1),'-');
    assert.match(prompt, /<h1>Before<\/h1>/);
    const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema')+1],'utf8'));
    assert.deepEqual(schema.required,['message','patch']);
    const out = args[args.indexOf('--output-last-message')+1];
    assert.equal(dirname(out),cwd);
    await writeFile(out,JSON.stringify({message:'Updated',patch:{find:'Before',replace:'After'}}));
  });
  assert.equal(result.patch.replace,'After');
});

test('page chat checks consent, resolves the route and edits only the draft', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  const app = createStudio({ask:async (_,input) => {
    assert.equal(input.file,'src/Dashboard.vue');
    assert.equal(input.route,'/dashboard');
    return {message:'Updated',patch:{find:'Before',replace:'After'}};
  }});
  await mkdir(join(root,'src','router'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'vite'},dependencies:{vue:'fixture'}}));
  const original = join(root,'src','Dashboard.vue');
  await writeFile(original,'<template>Before</template>');
  await writeFile(join(root,'src','router','index.js'),"export default [{path:'/dashboard',component:()=>import('../Dashboard.vue')}]");
  await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:' + app.address().port;
  const call = (action, data = {}, origin = url) => fetch(url+'/api/vue',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})});
  try {
    assert.equal((await call('import',{folder:root},'https://elsewhere.test')).status,403);
    assert.equal((await call('import',{folder:root})).status,200);
    assert.deepEqual(await (await call('resolve',{route:'/dashboard'})).json(),{file:'src/Dashboard.vue'});
    const prompt = {route:'/dashboard',prompt:'Update heading',file:'../outside.vue'};
    assert.equal((await call('chat',prompt)).status,403);
    const result = await (await call('chat',{...prompt,approved:true})).json();
    assert.equal(result.file.text,'<template>After</template>');
    assert.equal(result.previous,'<template>Before</template>');
    assert.equal(await readFile(original,'utf8'),'<template>Before</template>');
    assert.equal((await call('close')).status,200);
  } finally {
    await app.closeWorkspace();
    await new Promise(resolve=>app.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
