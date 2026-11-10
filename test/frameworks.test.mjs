import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { startDesktopServer } from '../desktop/server.mjs';
import { routeBridge } from '../server/vue-page.mjs';

test('React preview selection reports the JSX source from development metadata', () => {
  const handlers = new Map();
  const messages = [];
  const origin = 'http://localhost:4320';
  const parent = {postMessage(message) { messages.push(message); }};
  class Element { getAttribute() { return null; } }
  const element = Object.assign(new Element(),{
    localName:'button',outerHTML:'<button>Save</button>',textContent:'Save',
    '__reactFiber$fixture':{
      _debugStack:{stack:'Error: react-stack-top-frame\n    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react.js:3:4)\n    at SaveButton (http://localhost:5173/src/components/Button.tsx?t=42:15:17)'},
      _debugOwner:{type:{name:'SaveButton'}}
    }
  });
  runInNewContext(routeBridge(origin,'react'),{
    parent,Element,location:{hash:'',pathname:'/settings'},setInterval() {},
    window:{addEventListener(name,listener) {handlers.set(name,listener);}}
  });
  handlers.get('message')({source:parent,origin,data:{type:'studio-vue-pick',active:true}});
  handlers.get('click')({target:element,preventDefault() {},stopImmediatePropagation() {}});
  assert.equal(messages.at(-1).component,'http://localhost:5173/src/components/Button.tsx');
  assert.equal(messages.at(-1).componentName,'SaveButton');
});

test('React Vite projects expose their component source and can link a NestJS backend', async () => {
  const root = await mkdtemp(join(tmpdir(),'open-studio-frameworks-'));
  const frontend = join(root,'frontend');
  const backend = join(root,'backend');
  const desktop = await startDesktopServer({store:join(root,'drafts')});
  const call = async (action, options) => {
    const response = await fetch(desktop.url + 'api/vue',{
      method:'POST',headers:{Origin:new URL(desktop.url).origin,'Content-Type':'application/json'},
      body:JSON.stringify({action,...options})
    });
    const body = await response.json();
    assert.equal(response.status,200,body.error);
    return body;
  };
  try {
    await mkdir(join(frontend,'src'),{recursive:true});
    await writeFile(join(frontend,'package.json'),JSON.stringify({dependencies:{react:'fixture','react-dom':'fixture'},
      scripts:{dev:'node node_modules/vite/bin/vite.js'}}));
    await mkdir(join(frontend,'node_modules'));
    for (const dependency of ['vite','react','react-dom']) {
      await symlink(await realpath(join('node_modules',dependency)),join(frontend,'node_modules',dependency),
        process.platform === 'win32' ? 'junction' : 'dir');
    }
    await writeFile(join(frontend,'index.html'),'<html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
    await writeFile(join(frontend,'src','main.tsx'),`import {createRoot} from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);`);
    await writeFile(join(frontend,'src','App.tsx'),"import Button from './Button';\nexport default () => <Button />;");
    await writeFile(join(frontend,'src','Button.tsx'),'export default () => <button>Before</button>;');
    await mkdir(backend);
    await writeFile(join(backend,'package.json'),JSON.stringify({dependencies:{'@nestjs/core':'fixture'}}));
    const opened = (await call('open',{folder:frontend})).workspace;
    assert.equal(opened.canPreview,true);
    const portCheck = createServer();
    await new Promise((resolve,reject) => portCheck.once('error',reject).listen(0,'localhost',resolve));
    const {port} = portCheck.address();
    await new Promise(resolve => portCheck.close(resolve));
    const running = (await call('start',{port,approved:true})).workspace;
    const page = await fetch(running.url);
    assert.equal(page.status,200);
    assert.match(await page.text(),/studio-vue-hello/);
    for (const file of ['main.tsx','App.tsx','Button.tsx']) {
      const module = await fetch(new URL('/src/' + file,running.url));
      const source = await module.text();
      assert.equal(module.status,200,source.slice(0,700));
    }
    assert.equal((await call('resolve',{route:'/'})).file,'src/App.tsx');
    const selection = await call('resolve',{route:'/',componentName:'Button',selection:true});
    assert.deepEqual(selection,{file:'src/Button.tsx',componentResolved:true,usage:{pages:1,files:1}});
    const file = await call('read',{file:selection.file});
    assert.match((await call('format-source',{file:file.file,text:file.text})).text,/<button>Before<\/button>/);
    assert.equal((await call('write',{file:file.file,hash:file.hash,text:file.text.replace('Before','After')})).text.includes('After'),true);
    const linked = (await call('link-backend',{folder:backend})).workspace;
    assert.equal(linked.backend.folder,await realpath(backend));
    assert.equal(linked.architecture,true);
  } finally {
    await desktop.stop();
    await rm(root,{recursive:true,force:true});
  }
});

test('standalone NestJS architecture links registered modules and controllers to source', async () => {
  const {openArchitecture} = await import('../server/architecture.mjs');
  const root = await mkdtemp(join(tmpdir(),'open-studio-nest-'));
  let architecture;
  try {
    await mkdir(join(root,'src'));
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{'@nestjs/core':'fixture'}}));
    await writeFile(join(root,'src','app.module.ts'),`import {Module} from '@nestjs/common';
import {UsersModule as Users} from './users.module';
@Module({imports: [Users]})
export class AppModule {}`);
    await writeFile(join(root,'src','users.module.ts'),`import {Module} from '@nestjs/common';
import {UsersController} from './users.controller';
@Module({controllers: [UsersController]})
export class UsersModule {}`);
    await writeFile(join(root,'src','users.controller.ts'),`import {Controller} from '@nestjs/common';
@Controller('users')
export class UsersController {}`);
    architecture = await openArchitecture(await realpath(root));
    assert.ok(architecture);
    await architecture.current;
    const {graph} = architecture.status();
    assert.equal(graph.system.nodes.find(node => node.id === 'backend').label,'NestJS API');
    const app = graph.modules.nodes.find(node => node.label === 'App Module');
    const users = graph.modules.nodes.find(node => node.label === 'Users Module');
    assert.equal(users.members[0].label,'UsersController');
    assert.equal(graph.modules.edges.find(edge => edge.from === app.id && edge.to === users.id).source.line,3);
    assert.match((await architecture.read(users.members[0].source)).text,/@Controller/);
  } finally {
    await architecture?.close();
    await rm(root,{recursive:true,force:true});
  }
});
