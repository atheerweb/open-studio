import React, {useEffect,useId,useRef,useState} from 'react';
import {
  ArrowDown, ArrowDownRight, ArrowRight, Box, Check, ChevronDown, ChevronRight, CircleAlert, Code2, Copy, Database,
  FileCode2, GitBranch, Layers, Network, RefreshCw, Search, Server, Settings2, Terminal, Workflow, X
} from 'lucide-react';
import {Select} from './select.jsx';
import './architecture.css';

const views = [
  {id:'modules',label:'Modules',Icon:Layers},
  {id:'flows',label:'Business Lifecycles',Icon:GitBranch},
  {id:'system',label:'System Design',Icon:Network}
];

const edgeKey = edge => JSON.stringify([edge.from,edge.to,edge.label]);
const evidenceKey = item => JSON.stringify([item?.label,item?.source?.path,item?.source?.line,item?.description,item?.inferred]);
const displayRelation = label => /^[\w]+(?:-[\w]+){2,}$/.test(label) ? label.replaceAll('-',' ') : label;

function Empty({Icon = Network,title,children}) {
  return <div className="arch-empty">
    <span className="arch-tile"><Icon size={21} aria-hidden="true"/></span>
    <h3>{title}</h3>
    <p>{children}</p>
  </div>;
}

function Evidence({item,api,onClose}) {
  const [result,setResult] = useState(null);
  const [error,setError] = useState('');
  const close = useRef(null);
  const {path,line} = item.source || {};
  useEffect(()=>{close.current?.focus();},[]);
  useEffect(()=>{
    if (!path) return;
    let active = true;
    api('architecture-source',{source:{path,line}}).then(value=>{
      if (active) setResult(value);
    }).catch(failure=>{
      if (active) setError(failure.message);
    });
    return ()=>{active = false;};
  },[api,path,line]);
  return <aside className="arch-evidence" aria-label="Source evidence">
    <header className="arch-evidence-header">
      <h3><Code2 size={16} aria-hidden="true"/> Source evidence</h3>
      <button type="button" className="arch-icon" ref={close} aria-label="Close source evidence" onClick={onClose}><X size={17} aria-hidden="true"/></button>
    </header>
    <div className="arch-evidence-body">
      <strong>{item.label}</strong>
      {item.description && <p>{item.description}</p>}
      {item.inferred && <span className="arch-tag" data-kind="inferred">Inferred</span>}
      {path && <p className="arch-source-path"><FileCode2 size={15} aria-hidden="true"/><code>{path}:{line}</code></p>}
      {error ? <p role="alert">{error}</p> : result ? <pre aria-label="Source excerpt" tabIndex={0}>
        {result.text.split('\n').map((text,index)=><span key={index} data-highlight={result.start + index === result.line}>
          <i aria-hidden="true">{result.start + index}</i>{text || ' '}
        </span>)}
      </pre> : <p role={path ? 'status' : undefined}>{path ? 'Loading source…' : 'Source location unavailable.'}</p>}
    </div>
  </aside>;
}

function chooseEdge(edge,nodes,select,event) {
  select({...edge,label:nodes.get(edge.from).label + ' → ' + nodes.get(edge.to).label,
    description:displayRelation(edge.label)},event);
}

function RelationshipList({title,edges,nodes,select}) {
  const incoming = title === 'Used by';
  const Icon = incoming ? ArrowDownRight : ArrowRight;
  return <section className="arch-relations" aria-label={title}>
    <h4>{title}<span className="arch-count">{edges.length}</span></h4>
    {edges.length ? edges.map(edge=>{
      const neighbor = nodes.get(incoming ? edge.from : edge.to);
      if (!neighbor) return null;
      return <button type="button" className="arch-row" key={edgeKey(edge)} onClick={event=>chooseEdge(edge,nodes,select,event)}>
        <Icon size={16} aria-hidden="true"/>
        <span><strong>{neighbor.label}</strong><small>{displayRelation(edge.label)}{edge.inferred ? ' · Inferred' : ''}</small></span>
        <ChevronRight size={14} aria-hidden="true"/>
      </button>;
    }) : <p>{incoming ? 'No incoming relationships found.' : 'No outgoing relationships found.'}</p>}
  </section>;
}

function MapCanvas({nodes,edges,focused,onChoose}) {
  const id = useId();
  const columns = nodes.length > 12 ? 4 : nodes.length > 4 ? 3 : 2;
  const rows = Math.ceil(nodes.length / columns);
  const width = 800;
  const height = Math.max(164,rows * 58 + 26);
  const stepX = width / columns;
  const boxWidth = Math.min(172,stepX - 30);
  const position = new Map(nodes.map((node,index)=>[
    node.id,{x:(index % columns + .5) * stepX,y:42 + Math.floor(index / columns) * 58}
  ]));
  const links = edges.filter(edge=>position.has(edge.from) && position.has(edge.to));
  const ordered = [...links.filter(edge=>edge.from !== focused && edge.to !== focused),
    ...links.filter(edge=>edge.from === focused || edge.to === focused)];
  return <svg className="arch-map-svg" viewBox={'0 0 ' + width + ' ' + height} role="group" aria-label="Interactive module map">
    <defs>
      <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0 8 4 0 8" className="arch-map-arrow"/>
      </marker>
    </defs>
    {ordered.map(edge=>{
      const from = position.get(edge.from);
      const to = position.get(edge.to);
      const active = edge.from === focused || edge.to === focused;
      const side = from.x === to.x ? 1 : Math.sign(to.x - from.x);
      const start = from.x + side * boxWidth / 2;
      const end = to.x - (from.x === to.x ? -1 : side) * boxWidth / 2;
      const bend = from.x === to.x ? 16 : Math.min(66,Math.abs(end - start) / 2);
      const d = 'M ' + start + ' ' + from.y + ' C ' + (start + side * bend) + ' ' + from.y + ' ' +
        (end + (from.x === to.x ? 1 : -side) * bend) + ' ' + to.y + ' ' + end + ' ' + to.y;
      return <path key={edgeKey(edge)} className="arch-map-link" data-active={active} data-inferred={!!edge.inferred} d={d}
        markerEnd={active ? 'url(#' + id + ')' : undefined} aria-hidden="true"/>;
    })}
    {nodes.map(node=>{
      const {x,y} = position.get(node.id);
      const active = node.id === focused;
      const limit = Math.floor((boxWidth - 34) / 7);
      const split = node.label.length > limit ? node.label.lastIndexOf(' ',limit) : -1;
      const first = split > 0 ? node.label.slice(0,split) : node.label;
      const second = split > 0 ? node.label.slice(split + 1) : '';
      const truncate = text=>text.length > limit ? text.slice(0,limit - 1) + '…' : text;
      return <g key={node.id} role="button" tabIndex={0} aria-label={node.label} aria-pressed={active}
        className="arch-map-node" data-active={active} transform={'translate(' + x + ' ' + y + ')'}
        onClick={()=>onChoose(node.id)} onKeyDown={event=>{
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onChoose(node.id);
          }
        }}>
        <title>{node.label}</title>
        <rect x={-boxWidth / 2} y="-19" width={boxWidth} height="38" rx="7"/>
        <rect className="arch-map-glyph" x={-boxWidth / 2 + 11} y="-4" width="8" height="8" rx="2"/>
        <text x={-boxWidth / 2 + 27} y={second ? -2 : 4}>{truncate(first)}</text>
        {second && <text x={-boxWidth / 2 + 27} y="13">{truncate(second)}</text>}
      </g>;
    })}
  </svg>;
}

function Modules({graph,active,onChoose,select}) {
  const [query,setQuery] = useState('');
  const directory = useRef(null);
  const selectedButton = useRef(null);
  const nodes = new Map(graph.nodes.map(node=>[node.id,node]));
  const module = nodes.get(active) || graph.nodes.find(node=>node.id === 'Lawsuit') || graph.nodes[0];
  useEffect(()=>{
    const list = directory.current;
    const button = selectedButton.current;
    if (!list || !button) return;
    const bounds = list.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (target.top < bounds.top) list.scrollTop += target.top - bounds.top - 3;
    else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom + 3;
  },[module?.id,query]);
  if (!module) return <Empty title="No modules found">The current graph has no identifiable modules.</Empty>;
  const incoming = graph.edges.filter(edge=>edge.to === module.id);
  const outgoing = graph.edges.filter(edge=>edge.from === module.id);
  const matching = graph.nodes.filter(node=>node.label.toLowerCase().includes(query.trim().toLowerCase()));
  const mapNodes = graph.nodes.length <= 24 ? graph.nodes : [module,...new Set([...incoming.map(edge=>nodes.get(edge.from)),
    ...outgoing.map(edge=>nodes.get(edge.to))])].filter(Boolean).slice(0,24);
  return <div className="arch-modules">
    <section className="arch-directory" aria-label="Module directory">
      <h3>Module directory <span className="arch-count">{graph.nodes.length}</span></h3>
      <label className="arch-search">
        <Search size={16} aria-hidden="true"/>
        <input type="search" aria-label="Find a module" placeholder="Find a module…" value={query} onChange={event=>setQuery(event.target.value)}/>
      </label>
      <div className="arch-directory-list" ref={directory}>
        {matching.map(node=><button type="button" className="arch-directory-item" key={node.id} aria-pressed={module.id === node.id}
          ref={module.id === node.id ? selectedButton : null} onClick={()=>onChoose(node.id)}>
          <Box size={15} aria-hidden="true"/><span>{node.label}</span><ChevronRight size={14} aria-hidden="true"/></button>)}
        {!matching.length && <p className="arch-no-results">No modules match “{query}”.</p>}
      </div>
    </section>
    <div className="arch-module-detail">
      <section className="arch-map" aria-label="Module relationships map">
        <header className="arch-card-header"><div><h3>{graph.nodes.length <= 24 ? 'Dependency map' : 'Nearby modules'}</h3>
          <p>{graph.nodes.length <= 24 ? 'Select a module to trace its connections.' : 'Showing up to 24 modules connected to your selection.'}</p></div>
          <span className="arch-map-key"><i/> Selected</span>
        </header>
        <div className="arch-map-surface"><MapCanvas nodes={mapNodes} edges={graph.edges} focused={module.id} onChoose={onChoose}/></div>
      </section>
      <section className="arch-module-summary" aria-label={module.label + ' details'}>
        <header className="arch-card-header">
          <div><span className="arch-kicker">Selected module</span><h3>{module.label}</h3>
            {module.description && <p>{module.description}</p>}</div>
          {module.source && <button type="button" className="arch-control" onClick={event=>select(module,event)}><Code2 size={15} aria-hidden="true"/> Source</button>}
        </header>
        <div className="arch-relation-grid">
          <RelationshipList title="Used by" edges={incoming} nodes={nodes} select={select}/>
          <RelationshipList title="Uses" edges={outgoing} nodes={nodes} select={select}/>
        </div>
        {module.members?.length > 0 && <details className="arch-files" key={module.id}>
          <summary><FileCode2 size={16} aria-hidden="true"/> Relevant source files <span className="arch-count">{module.members.length}</span><ChevronDown size={15} aria-hidden="true"/></summary>
          <div>{module.members.map(member=><button type="button" className="arch-row" key={member.source.path}
            onClick={event=>select(member,event)}><FileCode2 size={15} aria-hidden="true"/><span><strong>{member.label}</strong>
              <small>{member.source.path}</small></span><ChevronRight size={14} aria-hidden="true"/></button>)}</div>
        </details>}
      </section>
    </div>
  </div>;
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
  const expandControl = useRef(null);
  const nodes = new Map(flow.nodes.map(node=>[node.id,node]));
  const main = flow.main.map(id=>nodes.get(id)).filter(Boolean);
  const byTransition = new Map(flow.edges.map(edge=>[JSON.stringify([edge.from,edge.to]),edge]));
  const mainEdges = new Set(main.slice(1).map((step,index)=>byTransition.get(JSON.stringify([main[index].id,step.id]))));
  const branches = flow.edges.filter(edge=>!mainEdges.has(edge) && nodes.has(edge.from) && nodes.has(edge.to));
  const steps = expanded ? main : compactPath(flow,nodes);
  return <section className="arch-flow-card" aria-label={flow.label}>
    <header className="arch-card-header">
      <div><span className="arch-kicker">Main path</span><h3>{flow.label}</h3>
        <p>{main.length} stages{branches.length ? ' · ' + branches.length + ' alternate transitions' : ''}</p></div>
      <button type="button" className="arch-control" ref={expandControl} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
        {expanded ? 'Collapse details' : 'Expand details'}<ChevronDown size={15} aria-hidden="true"/>
      </button>
    </header>
    <div className="arch-flow-body">
      <ol className="arch-flow" aria-label="Main path">
        {steps.map((step,index)=>{
          const transition = expanded && byTransition.get(JSON.stringify([steps[index - 1]?.id,step.id]));
          return <li key={step.id}>
            {transition && <button type="button" className="arch-flow-transition" onClick={event=>chooseEdge(transition,nodes,select,event)}>
              <ArrowDown size={14} aria-hidden="true"/>{displayRelation(transition.label)}
            </button>}
            <span className="arch-step-number" aria-hidden="true">{String(index + 1).padStart(2,'0')}</span>
            <button type="button" className="arch-step" onClick={event=>{
              if (step.approvals) {setExpanded(true);expandControl.current?.focus();}
              else select(step,event);
            }}>
              <span><strong>{step.label}</strong>{step.approvals && <small>{step.approvals.length} steps</small>}</span>
              {step.approvals ? <ChevronDown size={17} aria-hidden="true"/> : <ChevronRight size={17} aria-hidden="true"/>}
            </button>
          </li>;
        })}
      </ol>
      {branches.length > 0 && <section className="arch-branches" aria-label="Alternate paths">
        <h4><GitBranch size={17} aria-hidden="true"/> Alternate paths <span className="arch-count">{branches.length}</span></h4>
        {expanded ? branches.map(edge=><button type="button" className="arch-row" key={edgeKey(edge)}
          onClick={event=>chooseEdge(edge,nodes,select,event)}><ArrowDownRight size={16} aria-hidden="true"/>
          <span><strong>{nodes.get(edge.to).label}</strong><small>From {nodes.get(edge.from).label}</small></span><ChevronRight size={14} aria-hidden="true"/></button>)
          : <p>Expand details to see where this workflow can branch.</p>}
      </section>}
    </div>
  </section>;
}

function Lifecycles({flows,active,onChoose,select}) {
  const flow = flows.find(item=>item.id === active) || flows.find(item=>item.id === 'local:Lawsuit') || flows[0];
  if (!flow) return <Empty Icon={GitBranch} title="No lifecycles found">The current graph has no identifiable business transitions.</Empty>;
  return <div className="arch-lifecycles">
    <div className="arch-flow-picker">
      <label>Business lifecycle
        <Select value={flow.id} onChange={event=>onChoose(event.target.value)}>
          {flows.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}
        </Select>
      </label>
      <span className="arch-tag">{flow.kind}</span>
    </div>
    <Lifecycle key={flow.id} flow={flow} select={select}/>
  </div>;
}

function SystemGraph({graph,select}) {
  const nodes = new Map(graph.nodes.map(node=>[node.id,node]));
  const backend = nodes.get('backend');
  const client = nodes.get('client');
  if (!backend) return <Empty title="No system components found">The current graph has no identifiable system boundary.</Empty>;
  const integrations = graph.edges.filter(edge=>edge.from === backend.id && nodes.has(edge.to));
  return <section className="arch-system">
    <header className="arch-card-header"><div><h3>System context</h3><p>Follow the backend’s connections to data, workers, and services.</p></div></header>
    <div className="arch-system-track">
      <div className="arch-system-lane">
        <span className="arch-kicker">Entry point</span>
        {client && <button type="button" className="arch-system-node" onClick={event=>select(client,event)}>
          <Box size={19} aria-hidden="true"/><span><strong>{client.label}</strong><small>External boundary</small></span>
        </button>}
      </div>
      <span className="arch-system-arrow"><ArrowRight size={17} aria-hidden="true"/><span>Requests</span></span>
      <div className="arch-system-lane">
        <span className="arch-kicker">Selected folder</span>
        <button type="button" className="arch-system-node arch-system-backend" onClick={event=>select(backend,event)}>
          <Server size={19} aria-hidden="true"/><span><strong>{backend.label}</strong><small>Application</small></span>
        </button>
      </div>
      <span className="arch-system-arrow"><ArrowRight size={17} aria-hidden="true"/><span>Connects</span></span>
      <div className="arch-system-lane">
        <span className="arch-kicker">Dependencies <span className="arch-count">{integrations.length}</span></span>
        {integrations.length ? integrations.map(edge=>{
          const node = nodes.get(edge.to);
          const Icon = node.id === 'database' ? Database : node.id === 'queue' ? Workflow : Network;
          return <button type="button" className="arch-system-node" key={edgeKey(edge)} onClick={event=>select({...node,...edge,label:node.label,
            description:edge.label,source:edge.source || node.source},event)}>
            <Icon size={18} aria-hidden="true"/><span><strong>{node.label}</strong><small>{edge.label}</small></span>
            {edge.inferred && <span className="arch-tag" data-kind="inferred">Inferred</span>}
          </button>;
        }) : <p>No dependencies found.</p>}
      </div>
    </div>
  </section>;
}

function Settings({result,terminal,pending,connectTerminal,toggleAI}) {
  const [copyMessage,setCopyMessage] = useState('');
  const command = useRef(null);
  if (!result?.canEnableAI && !result?.terminal) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(terminal);
      setCopyMessage('Copied');
    } catch {
      command.current?.select();
      setCopyMessage('Command selected. Press Ctrl+C to copy.');
    }
  }
  return <details className="arch-settings">
    <summary><Settings2 size={16} aria-hidden="true"/> Analysis settings <ChevronDown size={14} aria-hidden="true"/></summary>
    <div className="arch-settings-body">
      {result.canEnableAI && <div className="arch-settings-row"><div>
        <h3>Understand Anything</h3>
        <p>{result.aiEnabled ? 'Codex can analyze eligible source on refresh.' : 'Optionally enrich local diagrams using installed Codex skills.'}</p>
      </div><button type="button" className="arch-control" disabled={!!pending} onClick={toggleAI}>
        {result.aiEnabled ? 'Disable AI analysis' : 'Enable AI analysis'}
      </button></div>}
      {result.terminal && <div className="arch-settings-row"><div>
        <h3>PowerShell integration</h3><p>Refresh after successful pulls and pushes from a connected session.</p>
      </div><button type="button" className="arch-control" disabled={!!pending} onClick={()=>{setCopyMessage('');connectTerminal();}}>
        <Terminal size={15} aria-hidden="true"/>{terminal ? 'Hide command' : 'Connect PowerShell'}
      </button></div>}
      {terminal && <div className="arch-terminal">
        <p>Run this once in each PowerShell session you want to connect.</p>
        <div><input ref={command} readOnly aria-label="PowerShell connection command" value={terminal}
          onFocus={event=>event.target.select()}/>
          <button type="button" className="arch-control" onClick={copy}><Copy size={15} aria-hidden="true"/>Copy</button></div>
        <small role="status">{copyMessage}</small>
      </div>}
    </div>
  </details>;
}

export function ArchitecturePanel({api,hidden,projectName}) {
  const [result,setResult] = useState(null);
  const [failure,setFailure] = useState(null);
  const [pending,setPending] = useState('');
  const [view,setView] = useState('modules');
  const [moduleId,setModuleId] = useState('');
  const [flowId,setFlowId] = useState('');
  const [selected,setSelected] = useState(null);
  const [terminal,setTerminal] = useState(null);
  const sourceTrigger = useRef(null);
  const request = useRef(0);
  const action = useRef(false);
  useEffect(()=>{
    if (hidden) return;
    let active = true;
    let timer;
    async function poll() {
      const version = request.current;
      try {
        if (!action.current) {
          const status = await api('architecture-status');
          if (active && version === request.current) {
            setResult(status);
            setFailure(previous=>previous?.scope === 'status' ? null : previous);
          }
        }
      } catch (error) {
        if (active && version === request.current) setFailure({scope:'status',message:error.message});
      } finally {
        if (active) timer = setTimeout(poll,1500);
      }
    }
    void poll();
    return ()=>{active = false;clearTimeout(timer);};
  },[api,hidden]);

  async function perform(name,task) {
    if (action.current) return;
    action.current = true;
    request.current++;
    setPending(name);
    setFailure(null);
    try {await task();}
    catch (error) {setFailure({scope:'action',message:error.message});}
    finally {action.current = false;setPending('');}
  }
  function refresh() {
    void perform('refresh',async ()=>setResult(await api('architecture-refresh')));
  }
  function connectTerminal() {
    if (terminal) {setTerminal(null);return;}
    void perform('terminal',async ()=>setTerminal((await api('architecture-terminal')).command));
  }
  function toggleAI() {
    const enabled = !result?.aiEnabled;
    if (enabled && !confirm('Share eligible source files from this folder with Codex using the installed Understand Anything skills? This also enables sharing on future automatic refreshes.')) return;
    void perform('ai',async ()=>setResult(await api('architecture-ai',{enabled,approved:enabled})));
  }
  function select(item,event) {
    sourceTrigger.current = event?.currentTarget || null;
    setSelected(item);
  }
  function closeEvidence() {
    setSelected(null);
    sourceTrigger.current?.focus();
  }

  const graph = result?.graph;
  const waiting = pending === 'refresh' || (!result && !failure) || ['generating','updating'].includes(result?.state);
  const issue = failure?.message || result?.message;
  const notice = issue || result?.warning || (result?.importedStale && 'The imported graph could not be matched to the current source.');
  const outdated = !!graph && (!!result?.importedStale || result?.state === 'failed');
  const StatusIcon = waiting ? RefreshCw : outdated || issue ? CircleAlert : Check;
  const status = waiting ? (graph ? 'Updating diagrams' : 'Analyzing source') :
    outdated ? 'Needs refresh' : issue ? 'Check failed' : graph ? 'Ready' : 'Waiting for analysis';
  const counts = graph && {modules:graph.modules.nodes.length,flows:graph.lifecycles.length,system:graph.system.nodes.length};
  return <section className="architecture-panel" hidden={hidden} aria-label="Architecture">
    <header className="arch-top">
      <div className="arch-heading"><span className="arch-tile"><Network size={22} aria-hidden="true"/></span>
        <div><div className="arch-kicker">{projectName || 'Open project'}</div><h2>Architecture</h2></div>
      </div>
      <div className="arch-actions">
        <span className="arch-status" role="status" data-kind={outdated || issue ? 'warning' : waiting ? 'pending' : 'ready'}>
          <StatusIcon size={14} aria-hidden="true"/>{status}
        </span>
        <button type="button" className="arch-control" onClick={refresh} disabled={waiting || !!pending}>
          <RefreshCw size={15} aria-hidden="true"/>Refresh
        </button>
      </div>
    </header>
    <div className="arch-meta">
      <span>{graph?.analyzer || 'Project source'}{graph && ' · ' + graph.modules.edges.length + ' module relationships'}</span>
      <Settings result={result} terminal={terminal} pending={pending} connectTerminal={connectTerminal} toggleAI={toggleAI}/>
    </div>
    {notice && <p className="arch-notice" role={issue ? 'alert' : 'status'}>
      <CircleAlert size={16} aria-hidden="true"/>{notice}
    </p>}
    {graph ? <>
      <nav className="arch-tabs" aria-label="Architecture views">
        {views.map(({id,label,Icon})=><button type="button" key={id} aria-pressed={view === id}
          onClick={()=>{setView(id);select(null);}}><Icon size={16} aria-hidden="true"/>{label}
          <span className="arch-count">{counts[id]}</span></button>)}
      </nav>
      <div className="arch-workspace" data-inspecting={!!selected}>
        <div className="arch-view">
          {view === 'modules' && <Modules graph={graph.modules} active={moduleId} select={select}
            onChoose={id=>{setModuleId(id);select(null);}}/>}
          {view === 'flows' && <Lifecycles flows={graph.lifecycles} active={flowId} select={select}
            onChoose={id=>{setFlowId(id);select(null);}}/>}
          {view === 'system' && <SystemGraph graph={graph.system} select={select}/>}
        </div>
        {selected && <Evidence key={evidenceKey(selected)} item={selected} api={api} onClose={closeEvidence}/>}
      </div>
    </> : <Empty Icon={waiting ? Workflow : CircleAlert} title={waiting ? 'Building your architecture map' : 'Architecture is unavailable'}>
      {waiting ? 'Modules, business lifecycles, and system connections will appear here.' : 'Use Refresh to try the analysis again.'}
    </Empty>}
  </section>;
}
