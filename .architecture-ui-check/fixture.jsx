import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArchitecturePanel} from '../src/architecture-panel.jsx';
import '../src/theme.css';
import '../src/studio.css';

const modules = [
  {id:'Lawsuit', label:'Lawsuit'},
  {id:'workflow', label:'DocumentWorkflowAdministration'},
  {id:'notify', label:'Notification Delivery'},
  {id:'unrelated', label:'Unrelated module'}
];
const stages = [
  {id:'review', label:'Under Review'}, {id:'approved', label:'Approved'},
  {id:'returned', label:'Returned for Amendment'}, {id:'rejected', label:'Rejected'}
];
const source = {path:'workflow.php',line:1};
const edge = (from,to,label)=>({from,to,label,source});
const graph = {
  analyzer:'Fixture',
  modules:{nodes:modules,edges:[
    edge('workflow','Lawsuit','references'), edge('Lawsuit','notify','dispatches'),
    edge('notify','unrelated','references')
  ]},
  lifecycles:[{id:'local:Lawsuit',kind:'Fixture',label:'Lawsuit lifecycle',nodes:stages,
    main:['review','approved'], edges:[
      edge('review','approved','approve'),edge('review','returned','request-amendment'),
      edge('review','rejected','reject'),edge('returned','review','resubmit')
    ]}],
  system:{nodes:[],edges:[]}
};
const api = async action=>action === 'architecture-source'
  ? {text:'function transition() {}',start:1,line:1} : {state:'ready',graph};
createRoot(document.getElementById('root')).render(<ArchitecturePanel api={api}/>);
