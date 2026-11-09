import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDraftTurn } from '../server/draft-agent.mjs';

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
      return draft.pendingEdit.edits[0].after;
    }
  };
}

test('draft edits match across line endings and preserve the source style',async t => {
  const draft = await withDraft(t,'.card {\r\n  color: red;\r\n}\r\n');
  const updated = await draft.edit('.card {\n  color: red;','.card {\n  color: blue;');
  assert.equal(updated,'.card {\r\n  color: blue;\r\n}\r\n');
});

test('draft edits reject ambiguous line-ending matches',async t => {
  const source = '.card {\r\n  color: red;\r\n}\r\n'.repeat(2);
  const draft = await withDraft(t,source);
  await assert.rejects(draft.edit('.card {\n  color: red;',''),/matches more than once/);
  assert.equal(await draft.read(),source);
});
