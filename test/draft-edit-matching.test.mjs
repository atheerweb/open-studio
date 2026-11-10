import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveDraftTurn, runDraftTurn, undoDraftTurn } from '../server/draft-agent.mjs';

async function withDraft(t,source) {
  const directory = await mkdtemp(join(tmpdir(),'studio-edit-matching-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const file = 'src/card.css';
  const path = join(directory,file);
  await mkdir(join(directory,'src'));
  await writeFile(path,source);
  const draft = {directory,messages:[],files:[file],routes:[],async saveState() {},async refreshFiles() {}};
  return {
    read:() => readFile(path,'utf8'),
    async edit(find,replace) {
      await runDraftTurn(draft,{prompt:'Update the card',editApproval:'all'},async () => ({
        message:'Prepared the update',edits:[{file,find,replace}]
      }));
      return draft.pendingEdit;
    },
    decide: approved => approveDraftTurn(draft,draft.pendingEdit.id,approved)
  };
}

test('draft edits match across line endings and preserve the source style',async t => {
  const draft = await withDraft(t,'.card {\r\n  color: red;\r\n}\r\n');
  const pending = await draft.edit('.card {\n  color: red;','.card {\n  color: blue;');
  assert.equal(pending.edits[0].after,'.card {\r\n  color: blue;\r\n}\r\n');
});

test('draft review lists an ambiguous file and prevents applying it',async t => {
  const source = '.card {\r\n  color: red;\r\n}\r\n'.repeat(2);
  const draft = await withDraft(t,source);
  const pending = await draft.edit('.card {\n  color: red;','');
  assert.deepEqual(pending.edits,[]);
  assert.equal(pending.blockedFiles[0].file,'src/card.css');
  assert.match(pending.blockedFiles[0].reason,/matches more than once/);
  await assert.rejects(draft.decide(true),/No matching edits/);
  await draft.decide(false);
  assert.equal(await draft.read(),source);
});

test('a mismatched file leaves the other proposed files available for approval',async t => {
  const directory = await mkdtemp(join(tmpdir(),'studio-edit-review-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const calendar = 'src/calendar.css';
  const page = 'src/dashboard.css';
  await mkdir(join(directory,'src'));
  await writeFile(join(directory,calendar),'calendar');
  await writeFile(join(directory,page),'dashboard');
  const draft = {directory,messages:[],files:[calendar,page],routes:[],async saveState() {},async refreshFiles() {}};
  const propose = () => runDraftTurn(draft,{route:'/dashboard',prompt:'Improve the calendar',editApproval:'shared'},async () => ({
    message:'Prepared changes to the calendar and dashboard',edits:[
      {file:page,find:'dashboard',replace:'dashboard draft'},
      {file:calendar,find:'calendar',replace:'updated calendar'},
      {file:page,find:'stale text',replace:'updated dashboard'},
      {file:page,find:'dashboard draft',replace:'must also be skipped'}
    ]
  }));
  const read = file => readFile(join(directory,file),'utf8');

  await propose();
  assert.deepEqual(draft.pendingEdit.edits.map(edit => edit.file),[calendar]);
  assert.equal(draft.pendingEdit.blockedFiles[0].file,page);
  assert.match(draft.pendingEdit.blockedFiles[0].reason,/match/);
  assert.equal(await read(calendar),'calendar');
  assert.equal(await read(page),'dashboard');

  await approveDraftTurn(draft,draft.pendingEdit.id,false);
  assert.equal(draft.pendingEdit,null);
  assert.equal(await read(calendar),'calendar');

  await propose();
  await approveDraftTurn(draft,draft.pendingEdit.id,true);
  assert.equal(await read(calendar),'updated calendar');
  assert.equal(await read(page),'dashboard');
  await undoDraftTurn(draft);
  assert.equal(await read(calendar),'calendar');
});
