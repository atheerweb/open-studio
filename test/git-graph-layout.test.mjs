import assert from 'node:assert/strict';
import test from 'node:test';
import {layoutGitGraph} from '../src/git-graph-layout.mjs';

test('keeps merge parents on separate lanes until they reach a shared ancestor', () => {
  const {commits,lanes} = layoutGitGraph([
    {hash:'merge',parents:['main','topic']},
    {hash:'topic',parents:['base']},
    {hash:'main',parents:['base']},
    {hash:'base',parents:['outside-visible-history']}
  ]);

  assert.equal(lanes,2);
  assert.deepEqual(commits.map(({lane,passing,incoming,outgoing})=>({lane,passing,incoming,outgoing})),[
    {lane:0,passing:[],incoming:false,outgoing:[0,1]},
    {lane:1,passing:[0],incoming:true,outgoing:[1]},
    {lane:0,passing:[1],incoming:true,outgoing:[1]},
    {lane:1,passing:[],incoming:true,outgoing:[]}
  ]);
});
