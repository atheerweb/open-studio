import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VueDraft } from '../server/vue-draft.mjs';

test('the Windows dependency fallback rebuilds an interrupted copy without renaming a directory', {skip:process.platform !== 'win32'}, async t => {
  const root = await fs.mkdtemp(join(tmpdir(),'open-studio-dependency-test-'));
  t.after(() => fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:150}));
  const source = join(root,'source');
  const directory = join(root,'draft');
  const vitePath = ['node_modules','vite','bin','vite.js'];
  await fs.mkdir(join(source,...vitePath.slice(0,-1)),{recursive:true});
  await fs.writeFile(join(source,...vitePath),'dependency fixture');
  await fs.mkdir(join(directory,...vitePath.slice(0,-1)),{recursive:true});
  await fs.writeFile(join(directory,...vitePath),'incomplete fixture');
  await fs.writeFile(join(directory,'.open-studio-dependencies-incomplete'),'');

  const denied = () => Object.assign(new Error('operation not permitted'),{code:'EPERM'});
  t.mock.method(fs,'symlink',async () => { throw denied(); });
  const publish = t.mock.method(fs,'rename',async () => { throw denied(); });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const draft = new VueDraft(directory,source);
  draft.dependenciesReady = true; // A reopened draft can already contain Vite's entry point.
  await draft.prepareDependencies();
  await draft.prepareDependencies();
  assert.equal(publish.mock.callCount(),0);
  assert.equal(await fs.readFile(join(directory,...vitePath),'utf8'),'dependency fixture');
  assert.deepEqual(await fs.readdir(directory),['node_modules']);
});
