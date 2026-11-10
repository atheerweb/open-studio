import React, {useEffect,useState} from 'react';
import {ArrowDown, ArrowRight, GitBranch, Layers, Network, RefreshCw, Terminal} from 'lucide-react';
import './architecture.css';

const views = [['Modules',Layers],['Business Lifecycles',GitBranch],['System Design',Network]];

function Edge({edge,nodes,select}) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return null;
  return <button type="button" className="arch-edge" onClick={()=>select(edge)}>
    <span>{from.label}</span>
    <span className="arch-edge-label"><ArrowRight size={14} aria-hidden="true"/>{edge.label}</span>
    <span>{to.label}</span>
    {edge.inferred && <small>Inferred</small>}
  </button>;
}

function Evidence({item,api}) {
  const [result,setResult] = useState(null);
  const [error,setError] = useState('');
  useEffect(()=>{
    if (!item?.source) return;
    let active = true;
    api('architecture-source',{source:item.source}).then(value=>{
      if (active) setResult(value);
    }).catch(failure=>{
      if (active) setError(failure.message);
    });
    return ()=>{active = false;};
  },[api,item]);
  return <aside className="arch-evidence" aria-label="Source evidence">
    <h3>Source evidence</h3>
    {item ? <>
      <strong>{item.label}</strong>
      {item.description && <p>{item.description}</p>}
      {item.inferred && <p>Inferred relationship</p>}
      {item.source && <p className="arch-source-path">{item.source.path}:{item.source.line}</p>}
      {error ? <p role="alert">{error}</p> : result ? <pre aria-label="Source excerpt">
        {result.text.split('\n').map((line,index)=><span key={index} data-highlight={result.start + index === result.line}>
          <i aria-hidden="true">{result.start + index}</i>{line || ' '}
        </span>)}
      </pre> : <p>{item.source ? 'Loading source…' : 'Source location unavailable.'}</p>}
    </> : <p>Select a node or relationship to see the supporting code.</p>}
  </aside>;
}

function ModuleGraph({graph,select}) {
  const [active,setActive] = useState('');
  const nodes = new Map(graph.nodes.map(node=>[node.id,node]));
  const module = nodes.get(active) || graph.nodes.find(node=>node.id === 'Lawsuit') || graph.nodes[0];
  if (!module) return <p>No modules were found in this graph.</p>;
  const incoming = graph.edges.filter(edge=>edge.to === module.id);
  const outgoing = graph.edges.filter(edge=>edge.from === module.id);
  const coordinates = new Map(graph.nodes.map((node,index)=>{
    const angle = index * Math.PI * 2 / graph.nodes.length - Math.PI / 2;
    return [node.id,{x:360 + 280 * Math.cos(angle),y:184 + 143 * Math.sin(angle)}];
  }));
  return <>
    {graph.nodes.length < 60 && <svg viewBox="0 0 720 368" className="arch-overview" role="img" aria-label="Overview of module dependencies. Use the module buttons below to inspect each module.">
      <defs><marker id="arch-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0 8 4 0 8" fill="currentColor"/>
      </marker></defs>
      {graph.edges.map(edge=>{
        const from = coordinates.get(edge.from);
        const to = coordinates.get(edge.to);
        if (!from || !to) return null;
        const focus = edge.from === module.id || edge.to === module.id;
        const distance = Math.hypot(to.x - from.x,to.y - from.y);
        const offset = Math.min(26,distance / 4) / distance;
        return <line key={JSON.stringify([edge.from,edge.to,edge.label])} x1={from.x} y1={from.y}
          x2={to.x + (from.x - to.x) * offset} y2={to.y + (from.y - to.y) * offset}
          data-focus={focus} markerEnd={focus ? 'url(#arch-arrow)' : undefined}/>;
      })}
      {graph.nodes.map(node=>{
        const {x,y} = coordinates.get(node.id);
        return <g key={node.id} transform={'translate(' + x + ' ' + y + ')'} data-focus={module.id === node.id}>
          <circle r="8"/><text y="21" textAnchor="middle">{node.label}</text>
        </g>;
      })}
    </svg>}
    <div className="arch-module-list" aria-label="Modules">
      {graph.nodes.map(node=><button type="button" className="quiet" aria-pressed={module.id === node.id}
        key={node.id} onClick={()=>{setActive(node.id);select(node);}}>{node.label}</button>)}
    </div>
    <div className="arch-module-graph" aria-label={module.label + ' relationships'}>
      <div className="arch-lane"><h3>Incoming</h3>
        {incoming.length ? incoming.map(edge=><Edge key={edge.from + edge.label} edge={edge} nodes={nodes} select={select}/>) : <p>No incoming links found.</p>}
      </div>
      <button type="button" className="arch-node arch-focus" onClick={()=>select(module)}>{module.label}</button>
      <div className="arch-lane"><h3>Outgoing</h3>
        {outgoing.length ? outgoing.map(edge=><Edge key={edge.to + edge.label} edge={edge} nodes={nodes} select={select}/>) : <p>No outgoing links found.</p>}
      </div>
    </div>
    {module.members?.length > 0 && <details className="arch-files" key={module.id}>
      <summary>Explore relevant source files</summary>
      <div className="arch-module-list">{module.members.map(member=><button type="button" className="quiet"
        key={member.source.path} title={member.source.path} onClick={()=>select(member)}>{member.label}</button>)}</div>
    </details>}
  </>;
}

function compactPath(flow,nodes) {
  const steps = [];
  for (const id of flow.main) {
    const node = nodes.get(id);
    if (!node) continue;
    const last = steps.at(-1);
    if (/approval|approved/i.test(node.label)) {
      if (last?.approvals) last.approvals.push(node);
      else steps.push({id:'approvals:' + node.id,label:'Approvals',approvals:[node]});
    } else steps.push(node);
  }
  return steps;
}

function Lifecycle({flow,select}) {
  const [expanded,setExpanded] = useState(false);
  const nodes = new Map(flow.nodes.map(node=>[node.id,node]));
  const mainTransitions = new Set(flow.main.slice(1).map((id,i)=>JSON.stringify([flow.main[i],id])));
  const branches = flow.edges.filter(edge=>!mainTransitions.has(JSON.stringify([edge.from,edge.to])));
  const steps = expanded ? flow.main.map(id=>nodes.get(id)).filter(Boolean) : compactPath(flow,nodes);
  return <>
    <div className="arch-lifecycle-header"><span>{flow.kind}</span>
      <button type="button" className="quiet" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? 'Collapse details' : 'Expand details'}{branches.length > 0 && !expanded ? ' · ' + branches.length + ' alternate transitions' : ''}
      </button>
    </div>
    <ol className="arch-flow" aria-label="Main path">
      {steps.map((step,index)=><li key={step.id}>
        {index > 0 && <ArrowDown className="arch-flow-arrow" size={18} aria-hidden="true"/>}
        <button type="button" className="arch-node" onClick={()=>step.approvals ? setExpanded(true) : select(step)}>
          {step.label}{step.approvals && <small>{step.approvals.length} steps · expand</small>}
        </button>
      </li>)}
    </ol>
    {expanded && <>
      <h3>Transitions</h3>
      <div className="arch-transition-list">{flow.edges.filter(edge=>!branches.includes(edge)).map(edge=>
        <Edge key={JSON.stringify([edge.from,edge.to])} edge={edge} nodes={nodes} select={select}/>)}</div>
      {branches.length > 0 && <>
        <h3>Alternate transitions</h3>
        <div className="arch-transition-list">{branches.map(edge=>
          <Edge key={JSON.stringify([edge.from,edge.to])} edge={edge} nodes={nodes} select={select}/>)}</div>
      </>}
    </>}
  </>;
}

function Lifecycles({flows,select}) {
  const [active,setActive] = useState('');
  const flow = flows.find(item=>item.id === active) || flows.find(item=>item.id === 'local:Lawsuit') || flows[0];
  if (!flow) return <p>No business lifecycle with identifiable transitions was found.</p>;
  return <>
    <label className="arch-select">Business lifecycle
      <select value={flow.id} onChange={event=>{setActive(event.target.value);select(null);}}>
        {flows.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
    <Lifecycle key={flow.id} flow={flow} select={select}/>
  </>;
}

function SystemGraph({graph,select}) {
  const nodes = new Map(graph.nodes.map(node=>[node.id,node]));
  const api = nodes.get('backend');
  const client = nodes.get('client');
  if (!api) return <p>No system components were found.</p>;
  return <div className="arch-system">
    <div className="arch-system-core">
      {client && <button type="button" className="arch-node" onClick={()=>select(client)}>{client.label}<small>External boundary</small></button>}
      <ArrowRight size={18} aria-hidden="true"/>
      <button type="button" className="arch-node arch-focus" onClick={()=>select(api)}>{api.label}</button>
    </div>
    <div className="arch-system-links" aria-label="System connections">
      {graph.edges.filter(edge=>edge.from === api.id).map(edge=>{
        const node = nodes.get(edge.to);
        return node && <button type="button" className="arch-node" key={edge.to} onClick={()=>select({...node,...edge,label:node.label,
          description:edge.label,source:edge.source || node.source})}>
          <small>{edge.label}</small>{node.label}<small>{node.type}{edge.inferred ? ' · Inferred' : ''}</small>
        </button>;
      })}
    </div>
  </div>;
}

export function ArchitecturePanel({api,hidden}) {
  const [result,setResult] = useState(null);
  const [failure,setFailure] = useState('');
  const [view,setView] = useState(views[0][0]);
  const [selected,select] = useState(null);
  const [terminal,setTerminal] = useState(null);
  useEffect(()=>{
    if (hidden) return;
    let active = true;
    let timer;
    async function poll() {
      try {
        const status = await api('architecture-status');
        if (active) {setResult(status);setFailure('');}
      } catch (error) {
        if (active) setFailure(error.message);
      } finally {
        if (active) timer = setTimeout(poll,1500);
      }
    }
    void poll();
    return ()=>{active = false;clearTimeout(timer);};
  },[api,hidden]);
  async function refresh() {
    try {setResult(await api('architecture-refresh'));setFailure('');}
    catch (error) {setFailure(error.message);}
  }
  async function connectTerminal() {
    try {setTerminal((await api('architecture-terminal')).command);}
    catch (error) {setFailure(error.message);}
  }
  async function toggleAI() {
    const enabled = !result?.aiEnabled;
    if (enabled && !confirm('Share eligible source files from this folder with Codex using the installed Understand Anything skills? This also enables sharing on future automatic refreshes.')) return;
    try {setResult(await api('architecture-ai',{enabled,approved:enabled}));setFailure('');}
    catch (error) {setFailure(error.message);}
  }
  const graph = result?.graph;
  const waiting = !result || ['generating','updating'].includes(result.state);
  return <section className="architecture-panel" hidden={hidden} aria-label="Architecture">
    <header className="arch-toolbar">
      <div><h2>Architecture</h2>
        <p role="status">{waiting ? (graph ? 'Updating diagrams…' : 'Analyzing project source…') :
          graph ? graph.analyzer + (result.importedStale ? ' · Imported graph freshness unverified' : '') : 'No diagrams available'}</p></div>
      <div className="arch-actions">
        {result?.canEnableAI && <button type="button" className="quiet" onClick={toggleAI}>
          {result.aiEnabled ? 'Disable AI analysis' : 'Enable AI analysis'}
        </button>}
        {result?.terminal && <button type="button" className="quiet" onClick={connectTerminal}><Terminal size={15}/>Connect PowerShell</button>}
        <button type="button" className="quiet" onClick={refresh} disabled={waiting}><RefreshCw size={15}/>Refresh</button>
      </div>
    </header>
    {(failure || result?.message) && <p className="arch-error" role="alert">{failure || result.message}</p>}
    {result?.warning && <p className="arch-warning" role="status">{result.warning}</p>}
    {terminal && <div className="arch-terminal">
      <p>Run this once in each PowerShell session where you use <code>git pull</code> and <code>git push</code>.</p>
      <input readOnly aria-label="PowerShell connection command" value={terminal} onFocus={event=>event.target.select()}/>
    </div>}
    {graph && <>
      <nav className="arch-tabs" aria-label="Architecture views">
        {views.map(([name,Icon])=><button type="button" className="quiet" key={name} aria-pressed={view === name}
          onClick={()=>{setView(name);select(null);}}><Icon size={15} aria-hidden="true"/>{name}</button>)}
      </nav>
      <div className="arch-workspace">
        <div className="arch-diagram">
          {view === 'Modules' && <ModuleGraph graph={graph.modules} select={select}/>}
          {view === 'Business Lifecycles' && <Lifecycles flows={graph.lifecycles} select={select}/>}
          {view === 'System Design' && <SystemGraph graph={graph.system} select={select}/>}
        </div>
        <Evidence key={JSON.stringify(selected)} item={selected} api={api}/>
      </div>
    </>}
  </section>;
}
