import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDraftTurn } from '../server/draft-agent.mjs';

test('a Codex turn exposes command details live and keeps the outcome with its reply', async () => {
  const draft = {messages:[],files:[],async saveState() {}};
  await runDraftTurn(draft,{route:'/cases',prompt:'Inspect the cards'},async ({emit}) => {
    const item = {id:'item_1',type:'command_execution',command:'rg --files src'};
    emit({type:'item.started',item:{...item,status:'in_progress'}});
    assert.equal(draft.agentSteps[0].detail,'rg --files src');
    assert.equal(draft.agentSteps[0].state,'running');
    emit({type:'item.completed',item:{...item,status:'failed',exit_code:2}});
    emit({type:'item.completed',item:{id:'item_2',type:'reasoning',text:'Internal reasoning'}});
    return {message:'I inspected the draft.',edits:[]};
  });
  assert.equal(draft.agentActivity,null);
  assert.deepEqual(draft.messages.at(-1).activity,[
    {id:'item_1',kind:'command',detail:'rg --files src',state:'failed',exitCode:2}
  ]);
});
