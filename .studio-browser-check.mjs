import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio } from './server/studio.mjs';
import { createServer as createVite } from 'vite';
const tmp = await mkdtemp(join(tmpdir(),'studio-browser-'));
const fixture = join(tmp,'fixture');
await mkdir(join(fixture,'src'),{recursive:true});
await writeFile(join(fixture,'package.json'),'{"scripts":{"dev":"vite"},"dependencies":{"vue":"fixture"}}');
const file = join(fixture,'src','App.vue');
await writeFile(file,'<template>Before</template>');
for (const args of [['init'],['add','.']]) execFileSync('git',args,{cwd:fixture});
await writeFile(file,'<template>Visible fixture</template>');
const prod = process.argv.includes('--production');
const app = createStudio(prod ? {} : {serveDevelopment:(req,res,next)=>vite.middlewares(req,res,next)});
const vite = prod ? null : await createVite({cacheDir:join(tmp,'vite'),server:{middlewareMode:true,ws:{server:app}}});
await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
const origin = 'http://localhost:' + app.address().port;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+join(tmp,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});
let ws;
try {
  const pause = () => new Promise(resolve=>setTimeout(resolve,100));
  async function until(fn) {
    for (let i=0;i<100;i++) { const result = await fn(); if (result) return result; await pause(); }
    throw Error('Timed out waiting for browser state');
  }
  const port = await until(()=>readFile(join(tmp,'chrome','DevToolsActivePort'),'utf8').then(x=>x.split(/\r?\n/)[0]).catch(()=>null));
  const page = (await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(target=>target.type === 'page' && target.url === 'about:blank');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ ws.onopen=resolve; ws.onerror=reject; });
  let id = 0;
  const replies = new Map();
  const errors = [];
  ws.onmessage = ({data}) => {
    const msg = JSON.parse(data);
    if (msg.id) replies.get(msg.id)?.(msg.result);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description);
  };
  const send = (method,params={}) => new Promise(resolve=>{ replies.set(++id,resolve); ws.send(JSON.stringify({id,method,params})); });
  const evaluate = async expression => {
    const res = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (res?.exceptionDetails) throw Error(res.exceptionDetails.exception?.description);
    return res?.result?.value;
  };
  await send('Runtime.enable');
  const imported = await fetch(origin+'/api/vue',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'import',folder:fixture})});
  assert.equal(imported.status,200,await imported.text());
  await send('Page.navigate',{url:origin});
  const button = name => "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==="+JSON.stringify(name)+")";
  const click = async name => {
    await until(()=>evaluate('Boolean('+button(name)+')').catch(()=>false));
    await evaluate(button(name)+'.click()');
  };
  const visible = async (selector,expected) => {
    await until(()=>evaluate('Boolean(document.querySelector('+JSON.stringify(selector)+'))')).catch(()=>{});
    await pause(); await pause(); await pause();
    const state = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      const outer = node?.closest('.source-box');
      return {text:node?.textContent,rect:node?.getBoundingClientRect().toJSON(),opacity:outer && getComputedStyle(outer).opacity,body:document.body.innerText.slice(0,600)};
    })()`);
    console.log(selector, state.text ?? state.body, errors);
    assert.ok(state.text?.includes(expected) && state.rect.width > 0 && state.rect.height > 0 && Number(state.opacity) > 0, 'Content must be visible');
  };
  await pause(); await pause(); await pause(); await pause(); console.log(await evaluate('location.href'),await evaluate('document.body.innerText.slice(0,1200)'),errors);
  await until(()=>evaluate("document.body.innerText.includes('fixture')"));
  await click('Source');
  await visible('.cm-content','Visible fixture');
  await click('Diff');
  await visible('.scm-patch','<template>Visible fixture</template>');
  await click('Source');
  await visible('.cm-content','Visible fixture');
} finally {
  ws?.close();
  browser.kill();
  await app.closeWorkspace();
  await vite?.close();
  await new Promise(resolve=>app.close(resolve));
}





