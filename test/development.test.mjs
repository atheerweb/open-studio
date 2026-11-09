import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevelopmentStudio, createStudio } from '../server/studio.mjs';

test('the composer can list installed skills before importing a project', async () => {
  const skills = [{name:'brainstorming',description:'Explore an idea'}];
  const app = createStudio({listSkills:async () => skills});
  await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
  const origin = 'http://localhost:' + app.address().port;
  try {
    const response = await fetch(origin + '/api/vue',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({action:'agent-skills'})
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{skills});
  } finally {
    await new Promise(resolve=>app.close(resolve));
  }
});

test('Vite serves React source and the Studio API on the same origin', async () => {
  const app = await createDevelopmentStudio();
  await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
  const url = 'http://localhost:' + app.address().port;
  try {
    const legacy = await fetch('http://127.0.0.1:' + app.address().port,{redirect:'manual'});
    assert.equal(legacy.status,307);
    assert.equal(legacy.headers.get('location'),url + '/');
    const html = await (await fetch(url)).text();
    assert.match(html, /\/@vite\/client/);
    assert.match(html, /\/@react-refresh/);
    assert.equal((await fetch(url + '/src/main.jsx')).status,200);
    const request = origin => fetch(url + '/api/vue',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"action":"status"}'
    });
    assert.equal((await request('https://elsewhere.test')).status,403);
    assert.equal((await request('http://127.0.0.1:' + app.address().port)).status,403);
    assert.deepEqual(await (await request(url)).json(),{workspace:null});
  } finally {
    await app.closeDevelopment();
    await new Promise(resolve=>app.close(resolve));
  }
});
