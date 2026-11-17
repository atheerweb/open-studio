import React, {useEffect,useId,useRef,useState} from 'react';
import {
  ArrowDown, ArrowRight, Box, Check, ChevronDown, ChevronRight, CircleAlert, Code2, Copy, CornerUpLeft, Database,
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
const displayRelation = label => /^[\w]+(?:-[\w]+)+$/.test(label) ? label.replaceAll('-',' ') : label;

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

function DiagramLinks({canvas,links}) {
  const marker = useId();
  const [paths,setPaths] = useState([]);
  const signature = JSON.stringify(links);
  useEffect(()=>{
    const surface = canvas.current;
    if (!surface) return;
    const connections = JSON.parse(signature);
    let frame;
    function measure() {
      const bounds = surface.getBoundingClientRect();
      const nodes = new Map([...surface.querySelectorAll('[data-diagram-node]')]
        .map(node=>[node.dataset.diagramNode,node.getBoundingClientRect()]));
      const vertical = getComputedStyle(surface).getPropertyValue('--diagram-axis').trim() === 'vertical';
      const next = connections.flatMap(link=>{
        const from = nodes.get(link.from);
        const to = nodes.get(link.to);
        if (!from || !to) return [];
        const down = link.axis === 'vertical' || vertical;
        const x1 = (down ? from.left + from.width / 2 : from.right) - bounds.left;
        const y1 = (down ? from.bottom : from.top + from.height / 2) - bounds.top;
        const x2 = (down ? to.left + to.width / 2 : to.left) - bounds.left;
        const y2 = (down ? to.top : to.top + to.height / 2) - bounds.top;
        const bend = down ? Math.max(20,(y2 - y1) / 2) : Math.max(24,(x2 - x1) / 2);
        let d = down
          ? `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2 - 5}`
          : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 5} ${y2}`;
        if (!down && (link.kind === 'incoming' || link.kind === 'outgoing')) {
          const rail = (x1 + x2) / 2;
          d = `M ${x1} ${y1} H ${rail} V ${y2} H ${x2 - 5}`;
        }
        if (vertical) {
          const right = link.kind === 'alternate';
          const rail = right ? bounds.width - 8 : 8;
          const start = (right ? from.right : from.left) - bounds.left;
          const end = (right ? to.right : to.left) - bounds.left;
          const startY = from.top + from.height / 2 - bounds.top;
          const endY = to.top + to.height / 2 - bounds.top;
          const offset = right ? 5 : -5;
          d = `M ${start} ${startY} H ${rail} V ${endY} H ${end + offset}`;
        }
        return [{...link,d}];
      });
      setPaths(previous=>JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    measure();
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(surface);
    surface.querySelectorAll('[data-diagram-node]').forEach(node=>observer.observe(node));
    surface.ownerDocument.addEventListener('scroll',schedule,{capture:true,passive:true});
    return ()=>{
      observer.disconnect();
      cancelAnimationFrame(frame);
      surface.ownerDocument.removeEventListener('scroll',schedule,true);
    };
  },[canvas,signature]);
  return <svg className="arch-diagram-links" aria-hidden="true">
    <defs>{['incoming','outgoing','main','alternate'].map(kind=><marker key={kind} id={marker + kind}
      viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 8 4 L 0 8 Z" className="arch-diagram-arrow" data-kind={kind}/>
    </marker>)}</defs>
    {paths.map(path=><path key={path.id} d={path.d} data-kind={path.kind}
      markerEnd={'url(#' + marker + path.kind + ')'}/>)}
  </svg>;
}

function RelationshipList({incoming = false,edges,nodes,onChoose,select}) {
  const title = incoming ? 'Used by' : 'Uses';
  const direction = incoming ? 'incoming' : 'outgoing';
  const groups = Map.groupBy(edges,edge=>incoming ? edge.from : edge.to);
  return <section className="arch-relations" data-direction={incoming ? 'incoming' : 'outgoing'} aria-label={title}>
    <h4><span className="arch-legend-dot"/>{title}<span className="arch-count">{groups.size}</span></h4>
    <p className="arch-lane-caption">{incoming ? 'Modules that depend on this one' : 'Modules this one depends on'}</p>
    {edges.length ? <ul>{[...groups].map(([id,relations])=>{
      const neighbor = nodes.get(id);
      return <li className="arch-dependency-node" data-diagram-node={direction + ':' + id} key={id}>
        <button type="button" className="arch-dependency-name" onClick={()=>onChoose(neighbor.id)}>
          <span className="arch-node-icon"><Box size={17} aria-hidden="true"/></span>
          <strong>{neighbor.label}</strong><ChevronRight size={14} aria-hidden="true"/>
        </button>
        <div className="arch-node-relations">{relations.map(edge=><button type="button" key={edgeKey(edge)}
          aria-label={'View source evidence for ' + nodes.get(edge.from).label + ' → ' + nodes.get(edge.to).label + ' (' + displayRelation(edge.label) + ')'}
          onClick={event=>chooseEdge(edge,nodes,select,event)}>
          <span>{displayRelation(edge.label)}{edge.inferred ? ' · Inferred' : ''}</span><Code2 size={13} aria-hidden="true"/>
        </button>)}</div>
      </li>;
    })}</ul> : <p className="arch-lane-empty">{incoming ? 'No incoming dependencies' : 'No outgoing dependencies'}</p>}
  </section>;
}

function Modules({graph,active,onChoose,select}) {
  const [query,setQuery] = useState('');
  const directory = useRef(null);
  const selectedButton = useRef(null);
  const canvas = useRef(null);
  const mapSelection = useRef(null);
  const choosingFromMap = useRef(false);
  const nodes = new Map(graph.nodes.map(node=>[node.id,node]));
  const module = nodes.get(active) || graph.nodes.find(node=>node.id === 'Lawsuit') || graph.nodes[0];
  useEffect(()=>{
    if (choosingFromMap.current) {
      mapSelection.current?.focus();
      choosingFromMap.current = false;
    }
    const list = directory.current;
    const button = selectedButton.current;
    if (!list || !button) return;
    const bounds = list.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (target.top < bounds.top) list.scrollTop += target.top - bounds.top - 3;
    else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom + 3;
  },[module?.id,query]);
  if (!module) return <Empty title="No modules found">The current graph has no identifiable modules.</Empty>;
  const incoming = graph.edges.filter(edge=>edge.to === module.id && nodes.has(edge.from));
  const outgoing = graph.edges.filter(edge=>edge.from === module.id && nodes.has(edge.to));
  const matching = graph.nodes.filter(node=>node.label.toLowerCase().includes(query.trim().toLowerCase()));
  const links = [
    ...[...new Set(incoming.map(edge=>edge.from))].map(id=>({id:'incoming:' + id,from:'incoming:' + id,to:'selected',kind:'incoming'})),
    ...[...new Set(outgoing.map(edge=>edge.to))].map(id=>({id:'outgoing:' + id,from:'selected',to:'outgoing:' + id,kind:'outgoing'}))
  ];
  function chooseFromMap(id) {
    if (id === module.id) return;
    choosingFromMap.current = true;
    onChoose(id);
  }
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
        <header className="arch-card-header"><div><h3>Dependency map</h3>
          <p>Follow the arrows to trace how modules depend on each other.</p></div>
          <span className="arch-diagram-hint"><Box size={14} aria-hidden="true"/> Select any module to explore</span>
        </header>
        <div className="arch-map-viewport">
        <div className="arch-map-surface" ref={canvas} data-incoming={incoming.length > 0} data-outgoing={outgoing.length > 0}
          data-dense={Math.max(new Set(incoming.map(edge=>edge.from)).size,new Set(outgoing.map(edge=>edge.to)).size) > 6}>
          <DiagramLinks canvas={canvas} links={links}/>
          {incoming.length > 0 && <RelationshipList incoming edges={incoming} nodes={nodes} onChoose={chooseFromMap} select={select}/>}
          <div className="arch-selected-lane">
            <span className="arch-lane-label">Selected module</span>
            <div className="arch-map-selection" ref={mapSelection} tabIndex={-1} data-diagram-node="selected">
              <span className="arch-selected-icon"><Layers size={25} aria-hidden="true"/></span>
              <strong>{module.label}</strong>
              <span className="arch-selected-counts">{incoming.length} incoming · {outgoing.length} outgoing</span>
              {module.source && <button type="button" onClick={event=>select(module,event)}>
                <Code2 size={14} aria-hidden="true"/> View source</button>}
            </div>
          </div>
          {outgoing.length > 0 && <RelationshipList edges={outgoing} nodes={nodes} onChoose={chooseFromMap} select={select}/>}
        </div>
        </div>
        <footer className="arch-diagram-footer"><span><i/> Dependency direction
          {!incoming.length && ' · No incoming dependencies'}{!outgoing.length && ' · No outgoing dependencies'}</span>
          <span>Click a relationship label to view its source</span></footer>
      </section>
      {(module.description || module.source || module.members?.length > 0) && <section className="arch-module-summary" aria-label={module.label + ' details'}>
        <header className="arch-card-header">
          <div><h3>About {module.label}</h3>
            {module.description && <p>{module.description}</p>}</div>
          {module.source && <button type="button" className="arch-control" onClick={event=>select(module,event)}><Code2 size={15} aria-hidden="true"/> Source</button>}
        </header>
        {module.members?.length > 0 && <details className="arch-files" key={module.id}>
          <summary><FileCode2 size={16} aria-hidden="true"/> Relevant source files <span className="arch-count">{module.members.length}</span><ChevronDown size={15} aria-hidden="true"/></summary>
          <div>{module.members.map(member=><button type="button" className="arch-row" key={member.source.path}
            onClick={event=>select(member,event)}><FileCode2 size={15} aria-hidden="true"/><span><strong>{member.label}</strong>
              <small>{member.source.path}</small></span><ChevronRight size={14} aria-hidden="true"/></button>)}</div>
        </details>}
      </section>}
    </div>
  </div>;
}

function Lifecycle({flow,select}) {
  const canvas = useRef(null);
  const nodes = new Map(flow.nodes.map(node=>[node.id,node]));
  const main = flow.main.map(id=>nodes.get(id)).filter(Boolean);
  const transitionKey = (from,to)=>JSON.stringify([from,to]);
  const mainPairs = new Set(main.slice(1).map((step,index)=>transitionKey(main[index].id,step.id)));
  const branches = flow.edges.filter(edge=>!mainPairs.has(transitionKey(edge.from,edge.to)) && nodes.has(edge.from) && nodes.has(edge.to));
  const branchesBySource = Map.groupBy(branches,edge=>edge.from);
  const mainIndex = new Map(main.map((node,index)=>[node.id,index]));
  const otherSources = [...branchesBySource.keys()].filter(id=>!mainIndex.has(id)).map(id=>nodes.get(id));
  const links = [
    ...main.slice(1).filter((step,index)=>flow.edges.some(edge=>edge.from === main[index].id && edge.to === step.id))
      .map(step=>({id:'main:' + step.id,from:'stage:' + main[mainIndex.get(step.id) - 1].id,to:'stage:' + step.id,kind:'main',axis:'vertical'})),
    ...branches.map(edge=>({id:edgeKey(edge),from:'stage:' + edge.from,to:'branch:' + edgeKey(edge),kind:'alternate'}))
  ];
  function renderStage(step,index) {
    const alternate = branchesBySource.get(step.id) || [];
    const transitions = index > 0 ? flow.edges.filter(edge=>edge.from === main[index - 1].id && edge.to === step.id) : [];
    return <li className="arch-journey-row" key={step.id}>
      <div className="arch-stage-column">
        <div className="arch-stage-node" data-diagram-node={'stage:' + step.id}>
          <span className="arch-stage-index" aria-hidden="true">{index < 0 ? <GitBranch size={18}/> : String(index + 1).padStart(2,'0')}</span>
          <button type="button" className="arch-stage-name" onClick={event=>select(step,event)}>
            <small>{index < 0 ? 'Alternate state' : index === 0 ? 'Start' : index === main.length - 1 ? 'Final stage' : 'Stage ' + String(index + 1).padStart(2,'0')}</small>
            <strong>{step.label}</strong>
            {step.description && <span>{step.description}</span>}
          </button>
          <button type="button" className="arch-stage-source" aria-label={'View source for ' + step.label}
            onClick={event=>select(step,event)}><Code2 size={16} aria-hidden="true"/></button>
        </div>
        {transitions.length > 0 && <div className="arch-stage-transition">{transitions.map(edge=><button type="button" key={edgeKey(edge)}
          onClick={event=>chooseEdge(edge,nodes,select,event)}><ArrowDown size={13} aria-hidden="true"/>{displayRelation(edge.label)}</button>)}</div>}
      </div>
      <ul className="arch-stage-branches" aria-label={'Alternate paths from ' + step.label}>
        {alternate.map(edge=>{
          const target = mainIndex.get(edge.to);
          const returns = target !== undefined && (index < 0 || target <= index);
          const Icon = returns ? CornerUpLeft : ArrowRight;
          return <li key={edgeKey(edge)} data-diagram-node={'branch:' + edgeKey(edge)}>
            <button type="button" className="arch-branch-node" onClick={event=>chooseEdge(edge,nodes,select,event)}>
              <span className="arch-branch-action">{displayRelation(edge.label)}{edge.inferred ? ' · Inferred' : ''}</span>
              <span className="arch-branch-destination"><Icon size={17} aria-hidden="true"/><strong>{nodes.get(edge.to).label}</strong><Code2 size={14} aria-hidden="true"/></span>
              {target !== undefined && <small>{returns ? 'Returns to' : 'Continues at'} stage {String(target + 1).padStart(2,'0')}</small>}
            </button>
          </li>;
        })}
      </ul>
    </li>;
  }
  return <section className="arch-flow-card" aria-label={flow.label}>
    <header className="arch-card-header">
      <div><h3>{flow.label}</h3><p>Follow the main path down. Explore other outcomes beside each stage.</p></div>
      <span className="arch-diagram-hint">{main.length} stages · {branches.length} alternate transitions</span>
    </header>
    <div className="arch-journey-viewport">
    <div className="arch-flow-body" ref={canvas}>
      <DiagramLinks canvas={canvas} links={links}/>
      <div className="arch-journey-headings" aria-hidden="true">
        <span><i/> Main path</span><span><i/> Alternate paths</span>
      </div>
      <ol className="arch-flow" aria-label="Main path">{main.map(renderStage)}</ol>
      {otherSources.length > 0 && <section className="arch-alternate-continuations" aria-label="Alternate path continuations">
        <h4><GitBranch size={16} aria-hidden="true"/> Where alternate paths go next</h4>
        <ul className="arch-flow">{otherSources.map(step=>renderStage(step,-1))}</ul>
      </section>}
    </div>
    </div>
    <footer className="arch-diagram-footer"><span><i/> Main path <i className="arch-alternate-line"/> Alternate path</span><span>Select a stage or transition to view its source</span></footer>
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
