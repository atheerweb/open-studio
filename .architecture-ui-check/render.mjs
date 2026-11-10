import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const vite = await createServer({server:{middlewareMode:true},plugins:[{
  name:'expose-architecture-test-components',
  transform(code,id) {
    if (id.endsWith('/src/architecture-panel.jsx')) return code + '\nexport {Modules,Lifecycle};';
  }
}]});
try {
  const {Modules,Lifecycle} = await vite.ssrLoadModule('/src/architecture-panel.jsx');
  const render = (component,props)=>renderToStaticMarkup(React.createElement(component,props));
  const nodes = [
    {id:'review', label:'Under Review'}, {id:'approved', label:'Approved'},
    {id:'returned', label:'Returned for Amendment'}, {id:'rejected', label:'Rejected'}
  ];
  const flow = {label:'Lawsuit lifecycle', nodes, main:['review','approved'],edges:[
    {from:'review',to:'approved',label:'approve'}, {from:'review',to:'returned',label:'request-amendment'},
    {from:'review',to:'rejected',label:'reject'}, {from:'returned',to:'review',label:'resubmit'}
  ]};
  const branches = render(Lifecycle,{flow}).split('aria-label="Alternate paths"')[1];
  const moduleNodes = [
    {id:'Lawsuit', label:'Lawsuit'}, {id:'workflow', label:'DocumentWorkflowAdministration'},
    {id:'notify', label:'Notification Delivery'}, {id:'unrelated', label:'Unrelated module'}
  ];
  const graph = {nodes:moduleNodes,edges:[
    {from:'workflow',to:'Lawsuit',label:'references'}, {from:'Lawsuit',to:'notify',label:'dispatches'},
    {from:'notify',to:'unrelated',label:'references'}
  ]};
  const map = render(Modules,{graph}).split('aria-label="Module relationships map"')[1].split('aria-label="Lawsuit details"')[0];
  const checks = [
    ()=>assert.match(branches,/From Under Review/),
    ()=>assert.match(branches,/Returned for Amendment/),
    ()=>assert.match(branches,/resubmit/),
    ()=>assert.match(map,/Used by[\s\S]*DocumentWorkflowAdministration/),
    ()=>assert.match(map,/Uses[\s\S]*Notification Delivery/),
    ()=>assert.doesNotMatch(map,/Unrelated module/),
    ()=>assert.match(map,/View source evidence/)
  ];
  let failed = 0;
  for (const check of checks) {
    try { check(); } catch (error) { failed++; console.error(error.message.split('\n')[0]); }
  }
  console.log((checks.length - failed) + '/' + checks.length + ' architecture rendering checks passed');
  process.exitCode = failed ? 1 : 0;
} finally { await vite.close(); }
