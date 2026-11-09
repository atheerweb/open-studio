import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { askCodex } from '../server/codex.mjs';
import { createStudio } from '../server/studio.mjs';
import { VueDraft } from '../server/vue-draft.mjs';
import { bridgeFile } from '../server/draft-publish.mjs';

test('preview startup rejects blocked HTTP ports before preparing dependencies', async () => {
  const draft = new VueDraft('unused','unused');
  draft.prepareDependencies = async () => assert.fail('Preview setup should not start');
  await assert.rejects(draft.start(6000), /port 6000 is blocked.*5174/i);
  assert.equal(draft.state,'imported');
});

test('starting a saved preview only replaces the route bridge when its contents change', async () => {
  const directory = await mkdtemp(join(tmpdir(),'open-studio-bridge-'));
  try {
    const draft = new VueDraft(directory,directory);
    const origin = 'http://localhost:4173';
    const bridge = join(directory,bridgeFile);
    await writeFile(join(directory,'index.html'),'<head></head>');
    await draft.installBridge(origin);
    await utimes(bridge,1,1);
    const {mtimeMs} = await lstat(bridge);

    await draft.installBridge(origin);
    assert.equal((await lstat(bridge)).mtimeMs,mtimeMs);

    await draft.installBridge('http://localhost:4174');
    assert.match(await readFile(bridge,'utf8'),/http:\/\/localhost:4174/);
    await rm(bridge);
    await draft.installBridge('http://localhost:4174');
    assert.match(await readFile(bridge,'utf8'),/http:\/\/localhost:4174/);
  } finally {
    await rm(directory,{recursive:true,force:true});
  }
});

test('the folder picker returns a local selection and handles cancellation', async () => {
  const folder = join(tmpdir(),'Vue project');
  let picks = 0;
  const app = createStudio({pickFolder:async () => ++picks === 1 ? null : folder});
  await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:' + app.address().port;
  const pick = (origin = url) => fetch(url+'/api/vue',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'pick-folder'})});
  try {
    assert.equal((await pick('https://elsewhere.test')).status,403);
    for (const expected of [null,folder]) {
      const response = await pick();
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{folder:expected});
    }
  } finally {
    await new Promise(resolve=>app.close(resolve));
  }
});

test('import makes source available without copying installed dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  let draft;
  try {
    await mkdir(join(root,'src'));
    await mkdir(join(root,'node_modules','vite','bin'),{recursive:true});
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{vue:'fixture'},scripts:{dev:'vite'}}));
    await writeFile(join(root,'node_modules','vite','bin','vite.js'),'dependency fixture');
    await writeFile(join(root,'src','Page.vue'),'<template>Draft</template>');
    draft = await VueDraft.open(root);
    assert.equal((await draft.read('src/Page.vue')).text,'<template>Draft</template>');
    await assert.rejects(lstat(join(draft.directory,'node_modules')),{code:'ENOENT'});
    await draft.prepareDependencies();
    await draft.prepareDependencies();
    if (draft.dependencyFallback) assert.match(draft.dependencyFallback,/private copy/);
    else assert.equal(await realpath(join(draft.directory,'node_modules')),await realpath(join(root,'node_modules')));
    assert.equal(await readFile(join(draft.directory,'node_modules','vite','bin','vite.js'),'utf8'),'dependency fixture');
  } finally {
    await draft?.close();
    assert.equal(await readFile(join(root,'node_modules','vite','bin','vite.js'),'utf8'),'dependency fixture');
    await rm(root,{recursive:true,force:true});
  }
});

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
    assert.deepEqual(await (await call('git-diff')).json(),{available:false});
    const git = (...args) => execFileSync('git',args,{cwd:root,stdio:'pipe'});
    git('init');
    git('add','--','src/Dashboard.vue');
    await writeFile(original,'<template>Working tree</template>');
    await writeFile(join(root,'untracked.txt'),'New file');
    const gitChanges = await (await call('git-diff')).json();
    assert.equal(gitChanges.available,true);
    assert.equal(gitChanges.staged[0].path,'src/Dashboard.vue');
    assert.equal(gitChanges.staged[0].status,'A');
    const staged = await (await call('git-file',{group:'staged',path:'src/Dashboard.vue'})).json();
    assert.match(staged.patch,/\+<template>Before<\/template>/);
    assert.equal(gitChanges.unstaged[0].path,'src/Dashboard.vue');
    assert.equal(gitChanges.unstaged[0].status,'M');
    const unstaged = await (await call('git-file',{group:'unstaged',path:'src/Dashboard.vue'})).json();
    assert.match(unstaged.patch,/\+<template>Working tree<\/template>/);
    assert.ok(gitChanges.untracked.includes('untracked.txt'));
    assert.deepEqual(await (await call('git-file',{group:'untracked',path:'untracked.txt'})).json(),{text:'New file'});
    assert.equal((await call('git-file',{group:'unstaged',path:'../outside'})).status,400);
    await writeFile(original,'<template>Before</template>');
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

test('agent sessions isolate Codex history and restore the selected session on reopen', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  const source = join(root,'source');
  const store = join(root,'drafts');
  const threads = [];
  const app = createStudio({store,runAgent:async ({threadId,emit}) => {
    threads.push(threadId);
    emit({type:'thread.started',thread_id:threadId || 'new-thread'});
    return {message:'Reply',edits:[]};
  }});
  try {
    await mkdir(join(source,'src'),{recursive:true});
    await writeFile(join(source,'package.json'),JSON.stringify({scripts:{dev:'vite'},dependencies:{vue:'fixture'}}));
    await writeFile(join(source,'src','App.vue'),'<template>Before</template>');
    const legacy = await VueDraft.open(source,store);
    await legacy.close();
    const metadata = JSON.parse(await readFile(legacy.metadata,'utf8'));
    delete metadata.sessions;
    delete metadata.activeSessionId;
    await writeFile(legacy.metadata,JSON.stringify({...metadata,threadId:'legacy-thread',
      messages:[{author:'You',text:'Earlier message',route:'/'}]}));

    await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:' + app.address().port;
    const request = (action, data) => fetch(origin+'/api/vue',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,...data})});
    const call = async (action, data) => {
      const response = await request(action,data);
      const body = await response.json();
      assert.equal(response.status,200,body.error);
      return body.workspace;
    };
    const first = await call('import',{folder:source});
    const second = await call('agent-session',{sessionId:null});
    assert.equal(second.sessions.length,2);
    assert.notEqual(second.activeSessionId,first.activeSessionId);
    assert.deepEqual(second.messages,[]);
    assert.equal((await request('agent-session',{sessionId:'missing'})).status,404);
    assert.equal((await request('agent-turn',{sessionId:first.activeSessionId,route:'/',prompt:'Stale',approved:true})).status,409);
    await call('agent-turn',{sessionId:second.activeSessionId,route:'/',prompt:'New message',approved:true});
    await call('close');
    const reopened = await call('import',{folder:source});
    assert.equal(reopened.activeSessionId,second.activeSessionId);
    assert.deepEqual(reopened.messages.map(message=>message.text),['New message','Reply']);
    await call('agent-turn',{sessionId:second.activeSessionId,route:'/',prompt:'Continue',approved:true});
    const restored = await call('agent-session',{sessionId:first.activeSessionId});
    assert.deepEqual(restored.messages.map(message=>message.text),['Earlier message']);
    await call('agent-turn',{sessionId:first.activeSessionId,route:'/',prompt:'Resume',approved:true});
    assert.deepEqual(threads,[undefined,'new-thread','legacy-thread']);
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve=>app.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test('a saved project restores draft edits and publishes only the reviewed version', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  const source = join(root,'project');
  const store = join(root,'drafts');
  await mkdir(join(source,'src'),{recursive:true});
  await writeFile(join(source,'package.json'),JSON.stringify({scripts:{dev:'vite'},dependencies:{vue:'fixture'}}));
  const file = 'src/Page.vue';
  await writeFile(join(source,file),'<template>Original</template>');
  let draft;
  try {
    draft = await VueDraft.open(source,store);
    const current = await draft.read(file);
    await draft.write(file,current.hash,'<template>Draft</template>');
    await draft.close();
    draft = await VueDraft.open(source,store);
    assert.equal((await draft.read(file)).text,'<template>Draft</template>');
    const review = await draft.review();
    assert.equal(review.changes[0].file,file);
    await writeFile(join(source,file),'<template>External</template>');
    await assert.rejects(draft.publish(review.token),/conflict/i);
    assert.equal(await readFile(join(source,file),'utf8'),'<template>External</template>');
    const conflict = (await draft.review()).changes[0];
    await draft.resolveConflict(file,conflict.originalHash,'<template>Merged</template>');
    await draft.publish((await draft.review()).token);
    assert.equal(await readFile(join(source,file),'utf8'),'<template>Merged</template>');
    assert.deepEqual((await draft.review()).changes,[]);
  } finally {
    await draft?.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('a session holds multi-file changes for approval when a shared component is edited', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  let draft;
  try {
    await mkdir(join(root,'src','router'),{recursive:true});
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{dev:'vite'},dependencies:{vue:'fixture'}}));
    await writeFile(join(root,'src','router','index.js'),"export default [{path:'/one',component:()=>import('../One.vue')},{path:'/two',component:()=>import('../Two.vue')}]");
    for (const page of ['One','Two']) {
      await writeFile(join(root,'src',page+'.vue'),"<script setup>import Shared from './Shared.vue'</script><template><Shared /></template>");
    }
    await writeFile(join(root,'src','Shared.vue'),'<template>Before</template>');
    draft = await VueDraft.open(root);
    const {runDraftTurn, approveDraftTurn} = await import('../server/draft-agent.mjs');
    await runDraftTurn(draft,{route:'/one',file:'src/Shared.vue',prompt:'Update the shared component'},async ({emit}) => {
      emit({type:'thread.started',thread_id:'fixture-session'});
      return {message:'Prepared the update',edits:[
        {file:'src/Shared.vue',find:'Before',replace:'After'},
        {file:'src/extra.css',find:null,replace:'button {}'}
      ]};
    });
    assert.equal((await draft.read('src/Shared.vue')).text,'<template>Before</template>');
    assert.deepEqual(draft.pendingEdit.impacts,[{file:'src/Shared.vue',routes:['/one','/two']}]);
    await approveDraftTurn(draft,draft.pendingEdit.id);
    assert.equal((await draft.read('src/Shared.vue')).text,'<template>After</template>');
    assert.equal(await readFile(join(draft.directory,'src/extra.css'),'utf8'),'button {}');
    assert.equal(draft.threadId,'fixture-session');
  } finally {
    await draft?.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('the preview sends the selected Vue owner and preserves clicks outside selection mode', async () => {
  const {runInNewContext} = await import('node:vm');
  const {routeBridge} = await import('../server/vue-page.mjs');
  const handlers = new Map();
  const messages = [];
  const origin = 'http://localhost:4320';
  const parent = {postMessage(message,receiver) {
    assert.equal(receiver,origin);
    messages.push(message);
  }};
  class Element {
    getAttribute() { return null; }
  }
  const element = Object.assign(new Element(),{
    localName:'button',id:'save',textContent:'  Save  now  ',
    parentElement:{__vueParentComponent:{type:{__file:'/draft/src/Shared.vue'}}}
  });
  runInNewContext(routeBridge(origin),{
    parent,Element,location:{hash:'#/settings',pathname:'/'},setInterval() {},
    window:{addEventListener(name,listener) {handlers.set(name,listener);}}
  });
  let intercepted = 0;
  const click = {target:element,preventDefault() {intercepted++;},stopImmediatePropagation() {}};
  handlers.get('click')(click);
  assert.equal(intercepted,0);
  handlers.get('message')({source:parent,origin,data:{type:'studio-vue-pick',active:true}});
  handlers.get('click')(click);
  assert.equal(intercepted,1);
  assert.equal(messages.at(-1).route,'/settings');
  assert.equal(messages.at(-1).component,'/draft/src/Shared.vue');
  assert.equal(messages.at(-1).element.label,'Save now');
  handlers.get('click')(click);
  assert.equal(intercepted,1);
});

test('a running preview can review and publish agent edits through the Studio API', async () => {
  const {createServer} = await import('node:net');
  const {symlink} = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(),'open-studio-test-'));
  const source = join(root,'project');
  const store = join(root,'drafts');
  const app = createStudio({store,runAgent:async ({threadId,emit,model,reasoningEffort}) => {
    assert.equal(model,'gpt-fixture');
    assert.equal(reasoningEffort,'high');
    if (!threadId) {
      emit({type:'thread.started',thread_id:'fixture-thread'});
      return {message:'I can adjust the page density.',question:{
        text:'Which density do you prefer?',options:['Compact','Spacious']
      },edits:[]};
    }
    assert.equal(threadId,'fixture-thread');
    emit({type:'thread.started',thread_id:'fixture-thread'});
    return {message:'Updated the page and its style',edits:[
      {file:'src/App.vue',find:'Before',replace:'After'},
      {file:'src/page.css',find:null,replace:'button { color: blue; }'}
    ]};
  }});
  const portCheck = createServer();
  try {
    await mkdir(join(source,'src'),{recursive:true});
    await mkdir(join(source,'node_modules'));
    await symlink(await realpath('node_modules/vite'),join(source,'node_modules','vite'),
      process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(join(source,'package.json'),JSON.stringify({scripts:{dev:'node node_modules/vite/bin/vite.js'},dependencies:{vue:'fixture'}}));
    await writeFile(join(source,'index.html'),'<html><head></head><body><button>Preview fixture</button></body></html>');
    const file = 'src/App.vue';
    await writeFile(join(source,file),'<template>Before</template>');
    await new Promise((resolve,reject) => portCheck.once('error',reject).listen(0,'localhost',resolve));
    const previewPort = portCheck.address().port;
    await new Promise(resolve => portCheck.close(resolve));
    await new Promise((resolve,reject) => app.once('error',reject).listen(0,'127.0.0.1',resolve));
    const url = 'http://127.0.0.1:' + app.address().port;
    const call = async (action,values = {}) => {
      const response = await fetch(url+'/api/vue',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},
        body:JSON.stringify({action,...values})});
      const result = await response.json();
      assert.ok(response.ok,result.error);
      return result;
    };
    await call('import',{folder:source});
    const {workspace} = await call('start',{port:previewPort,approved:true}).catch(async error => {
      const status = await call('status');
      throw new Error(error.message + '\n' + status.workspace.logs);
    });
    assert.equal(workspace.state,'ready');
    assert.match(await (await fetch(workspace.url)).text(),/__open_studio_route__\.js/);
    assert.deepEqual(await call('resolve',{route:'/',componentName:'App',selection:true}),{file,componentResolved:true});
    const formatted = await call('format-source',{file,text:'<template>\n<button>Before</button>\n</template>'});
    assert.match(formatted.text,/<template>\r?\n  <button>Before<\/button>\r?\n<\/template>/);
    assert.equal((await call('read',{file})).text,'<template>Before</template>');
    await call('agent-turn',{route:'/',file,prompt:'Update the page',approved:true,
      model:'gpt-fixture',reasoningEffort:'high',editApproval:'all'});
    const question = (await call('status')).workspace.messages.at(-1).question;
    assert.deepEqual(question,{text:'Which density do you prefer?',options:['Compact','Spacious']});
    await call('agent-turn',{route:'/',file,prompt:question.options[0],approved:true,
      model:'gpt-fixture',reasoningEffort:'high',editApproval:'all'});
    const pending = (await call('status')).workspace.pendingEdit;
    assert.deepEqual(pending.files,[file,'src/page.css']);
    const blocked = await fetch(url+'/api/vue',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},
      body:JSON.stringify({action:'agent-session',sessionId:null})});
    assert.equal(blocked.status,409);
    assert.deepEqual((await call('review')).changes,[]);
    await call('agent-approval',{id:pending.id,approved:true});
    const review = await call('review');
    assert.deepEqual(review.changes.map(change => change.file),[file,'src/page.css']);
    await call('publish',{token:review.token,approved:true});
    assert.equal(await readFile(join(source,file),'utf8'),'<template>After</template>');
    assert.equal(await readFile(join(source,'src/page.css'),'utf8'),'button { color: blue; }');
    await call('close');
    const reopened = await call('import',{folder:source});
    assert.equal(reopened.workspace.messages.at(-1).author,'Studio');
    assert.deepEqual((await call('review')).changes,[]);
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve => app.close(resolve));
    if (portCheck.listening) await new Promise(resolve => portCheck.close(resolve));
    await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
});
