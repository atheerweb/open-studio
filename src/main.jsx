import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  ArrowRight, ArrowUp, ArrowUpRight, Braces, Check, ChevronDown, Code2, Command, FileCode2, FolderOpen,
  GitCompareArrows, Globe2, Layers3, Monitor, MousePointer2, SlidersHorizontal,
  CircleHelp, LoaderCircle, Play, Search, ShieldCheck, Smartphone, Sparkles, Square, Terminal, Undo2, X
} from 'lucide-react';
import './studio.css';
import {SkillPrompt} from './skill-prompt.jsx';

const SourceEditor = lazy(() => import('./source-editor.jsx'));

async function api(action, values = {}) {
  const response = await fetch('/api/vue',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...values})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The workspace request failed.');
  return result;
}

const loadSkills = () => api('agent-skills');

function AgentReply({text}) {
  return <p dir="auto">{text.split(/(\[[^\]\n]+\]\([^)]+\))/g).map((part,index) => {
    const link = /^\[([^\]\n]+)\]\(([^)]+)\)$/.exec(part);
    if (!link) return part;
    const [,label,url] = link;
    if (/^https?:\/\//i.test(url)) return <a key={index} href={url} target="_blank" rel="noreferrer">{label}</a>;
    return <span key={index} className="reply-reference" title={url}>{label}</span>;
  })}</p>;
}

function diffLines(before, after) {
  if (before === after) return [];
  const left = before.split('\n'), right = after.split('\n');
  let start = 0, a = left.length, b = right.length;
  while (start < a && start < b && left[start] === right[start]) start++;
  while (a > start && b > start && left[a-1] === right[b-1]) {a--; b--;}
  return [
    {kind:'context',text:'Change beginning at line ' + (start+1)},
    ...left.slice(start,a).map(text => ({kind:'remove',text:'− ' + text})),
    ...right.slice(start,b).map(text => ({kind:'add',text:'+ ' + text}))
  ];
}

function EmptyPreview({onImport, workspace, onStart, busy}) {
  return <div className="empty-preview">
    <div className="diagram" aria-hidden="true">
      <div className="diagram-window"><div className="diagram-bar"><i/><i/><i/><span/></div>
        <div className="diagram-body"><div className="diagram-sidebar"><i/><i/><i/></div>
          <div className="diagram-main"><b/><div className="diagram-grid"><i/><i/><i/></div>
            <div className="diagram-chart"><i/><i/><i/><i/><i/><i/><i/></div>
          </div>
        </div>
      </div>
      <div className="diagram-chip"><Play size={15} fill="currentColor"/></div>
      <div className="diagram-code"><Code2 size={21}/></div>
    </div>
    <h1>{workspace ? 'Your draft is ready to run' : 'Start with a Vue project'}</h1>
    <p>{workspace ? 'Start the dev server to browse your app and give Codex the context of the page you are viewing.'
      : 'Import a local folder to see your app here. Browse to any page, describe a change, and review the Vue diff beside the preview.'}</p>
    <button className="primary" disabled={busy} onClick={workspace ? onStart : onImport}>
      {workspace ? <Play size={16}/> : <FolderOpen size={17}/>}
      {workspace ? 'Start preview' : 'Import Vue project'} <ArrowRight size={16}/>
    </button>
  </div>;
}

function App() {
  const [workspace,setWorkspace] = useState(null);
  const [folder,setFolder] = useState('');
  const [importOpen,setImportOpen] = useState(false);
  const [port,setPort] = useState('5174');
  const [busy,setBusy] = useState('');
  const [previewProgress,setPreviewProgress] = useState(null);
  const [notice,setNotice] = useState(null);
  const [route,setRoute] = useState(null);
  const [pageFile,setPageFile] = useState(null);
  const [resolving,setResolving] = useState(false);
  const [manualRoute,setManualRoute] = useState(null);
  const [file,setFile] = useState(null);
  const [editor,setEditor] = useState('');
  const [selection,setSelection] = useState(null);
  const [componentResolved,setComponentResolved] = useState(false);
  const [picking,setPicking] = useState(false);
  const [review,setReview] = useState(null);
  const [resolution,setResolution] = useState(null);
  const [previewChecked,setPreviewChecked] = useState(false);
  const [tab,setTab] = useState('Preview');
  const [device,setDevice] = useState('desktop');
  const [filter,setFilter] = useState('');
  const [logOpen,setLogOpen] = useState(false);
  const [prompt,setPrompt] = useState('');
  const [consent,setConsent] = useState(false);
  const [models,setModels] = useState([]);
  const [modelStatus,setModelStatus] = useState('idle');
  const [model,setModel] = useState('');
  const [reasoningEffort,setReasoningEffort] = useState('');
  const [editApproval,setEditApproval] = useState('shared');
  const preview = useRef(null);
  const dialog = useRef(null);
  const chatLog = useRef(null);
  const followChat = useRef(true);
  const dirty = Boolean(file && editor !== file.text);
  const ready = workspace?.state === 'ready';
  const messages = workspace?.messages || [];
  const target = (manualRoute === route ? file?.file : null) || pageFile;
  const selectedModel = models.find(item => item.id === model);
  const pending = workspace?.pendingEdit;
  const latestMessage = messages.at(-1);
  const activity = workspace?.agentActivity || (busy === 'Waiting for Codex…' && !pending ? 'Starting Codex…' : '');
  const composerHint = pending ? 'Review the proposed edits above.' : activity ? 'You can draft your next message while Codex works.'
    : busy ? 'Wait for the current workspace action to finish.' : !route ? 'Open a page in the preview to start.'
    : resolving ? 'Finding the page source…' : dirty ? 'Save your source changes before sending.'
    : !consent ? 'Enable sharing below to send.' : '';

  useEffect(() => {
    api('status').then(result => setWorkspace(result.workspace)).catch(error => setNotice({error:true,text:error.message}));
  },[]);
  useEffect(() => {
    if (busy !== 'Starting Vite preview…') return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const {workspace} = await api('status');
        if (active) setPreviewProgress(workspace?.dependencyProgress || null);
      } catch {}
    },800);
    return () => {
      active = false;
      clearInterval(timer);
      setPreviewProgress(null);
    };
  },[busy]);
  useEffect(() => {
    if (busy !== 'Waiting for Codex…') return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const result = await api('status');
        if (active) setWorkspace(result.workspace);
      } catch {}
    },500);
    return () => {active = false; clearInterval(timer);};
  },[busy]);
  useEffect(() => {
    if (importOpen && !dialog.current.open) dialog.current.showModal();
    if (!importOpen && dialog.current.open) dialog.current.close();
  },[importOpen]);
  useEffect(() => {
    if (chatLog.current && followChat.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  },[messages.length,latestMessage,activity,pending]);
  useEffect(() => {
    if (!ready) return;
    const listen = event => {
      if (event.source !== preview.current?.contentWindow ||
          event.origin !== new URL(workspace.url).origin) return;
      if (event.data?.type === 'studio-vue-pick-cancel') return setPicking(false);
      if (!['studio-vue-route','studio-vue-selection'].includes(event.data?.type) ||
          typeof event.data.route !== 'string' || !/^\/(?!\/)[^?#\r\n]{0,499}$/.test(event.data.route)) return;
      setRoute(event.data.route);
      if (event.data.type === 'studio-vue-selection') {
        setPicking(false);
        setManualRoute(null);
        const element = Object.fromEntries(['tag','id','label','path'].map(key =>
          [key,typeof event.data.element?.[key] === 'string' ? event.data.element[key].slice(0,250) : '']));
        setSelection({route:event.data.route,component:typeof event.data.component === 'string'
          ? event.data.component.slice(0,2048) : null,componentName:typeof event.data.componentName === 'string'
          ? event.data.componentName.slice(0,160) : null,element});
      }
    };
    window.addEventListener('message',listen);
    return () => window.removeEventListener('message',listen);
  },[ready,workspace?.url]);
  useEffect(() => {
    setPageFile(null);
    setComponentResolved(false);
    if (!route) { setResolving(false); return; }
    let active = true;
    setResolving(true);
    const picked = selection?.route === route ? selection : null;
    api('resolve',{route,component:picked?.component,componentName:picked?.componentName,selection:!!picked}).then(result => {
      if (active) { setPageFile(result.file); setComponentResolved(result.componentResolved === true); }
    }).catch(error => {
      if (active) setNotice({error:true,text:error.message});
    }).finally(() => {
      if (active) setResolving(false);
    });
    return () => {active = false;};
  },[route,selection]);
  useEffect(() => {
    if (!pageFile || dirty || busy || file?.file === pageFile) return;
    let active = true;
    api('read',{file:pageFile}).then(result => {
      if (active) openFile(result);
    }).catch(error => {
      if (active) setNotice({error:true,text:error.message});
    });
    return () => {active = false;};
  },[pageFile]);

  function openFile(value) {
    setFile(value);
    setEditor(value?.text || '');
  }
  async function perform(label,task) {
    if (busy) return;
    setBusy(label);
    setNotice(null);
    try { await task(); }
    catch (error) { setNotice({error:true,text:error.message}); }
    finally { setBusy(''); }
  }
  function browseForFolder() {
    perform('Choosing folder…',async () => {
      const result = await api('pick-folder');
      if (result.folder) setFolder(result.folder);
    });
  }
  function importProject(event) {
    event.preventDefault();
    if (!folder) return;
    perform('Importing frontend…',async () => {
      setWorkspace((await api('import',{folder})).workspace);
      setFolder('');
      setImportOpen(false);
      setNotice({text:'Private draft created.'});
    });
  }
  function start() {
    if (!confirm('Run npm run dev for this trusted project from the private draft?')) return;
    perform('Starting Vite preview…',async () => {
      try {
        setWorkspace((await api('start',{port:Number(port),approved:true})).workspace);
        setTab('Preview');
      } catch (error) {
        setWorkspace((await api('status')).workspace);
        setLogOpen(true);
        throw error;
      }
    });
  }
  function close() {
    if (dirty && !confirm('Close the draft and discard the unsaved text in this editor?')) return;
    perform('Closing draft…',async () => {
      await api('close');
      setWorkspace(null); setRoute(null); setPageFile(null); setManualRoute(null);
      setResolving(false); setSelection(null); setPicking(false); setReview(null); setResolution(null);
      setPreviewChecked(false); setConsent(false); setPrompt(''); setTab('Preview');
      openFile(null);
    });
  }
  function choose(name) {
    if (dirty && !confirm('Discard the unsaved changes in this editor?')) return;
    perform('Opening source…',async () => {
      openFile(await api('read',{file:name}));
      setSelection(null);
      setManualRoute(route);
      setTab('Source');
    });
  }
  function save(text) {
    perform('Saving draft…',async () => {
      openFile(await api('write',{file:file.file,hash:file.hash,text}));
      setNotice({text:'Saved to draft.'});
    });
  }
  function formatSource() {
    perform('Formatting source…',async () => {
      const result = await api('format-source',{file:file.file,text:editor});
      setEditor(result.text);
      setNotice({text:result.text === editor ? 'Source is already formatted.' : 'Source formatted. Save to apply it to the draft.'});
    });
  }
  async function loadModels() {
    if (modelStatus === 'ready' || modelStatus === 'loading' || !workspace) return;
    setModelStatus('loading');
    try {
      setModels((await api('agent-models')).models);
      setModelStatus('ready');
    } catch (error) {
      setModelStatus(error.message === 'Unknown workspace action.' ? 'unsupported' : 'failed');
    }
  }
  function send(event) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request || composerHint) return;
    followChat.current = true;
    setPrompt('');
    perform('Waiting for Codex…',async () => {
      try {
        await api('agent-turn',{route,file:target,element:selection?.route === route ? selection.element : null,prompt:request,approved:true,
          model:model || undefined,reasoningEffort:reasoningEffort || undefined,editApproval});
      } finally {
        await refreshDraft();
      }
    });
  }
  async function refreshDraft() {
    const result = await api('status');
    setWorkspace(result.workspace);
    if (file) openFile(result.workspace.files.includes(file.file) ? await api('read',{file:file.file}) : null);
    if (tab === 'Diff') setReview(await api('review'));
    setPreviewChecked(false);
  }
  function decide(approved) {
    perform('Updating draft…',async () => {
      await api('agent-approval',{id:workspace.pendingEdit.id,approved});
      await refreshDraft();
    });
  }
  function togglePicker(active) {
    preview.current?.contentWindow?.postMessage({type:'studio-vue-pick',active},new URL(workspace.url).origin);
    setPicking(active);
  }
  function previewLoaded() {
    setPicking(false);
    setRoute(null);
    setSelection(null);
    setManualRoute(null);
    preview.current?.contentWindow?.postMessage({type:'studio-vue-hello'},new URL(workspace.url).origin);
  }
  function view(name) {
    if (picking && name !== 'Preview') togglePicker(false);
    if (name !== 'Diff' || !workspace) return setTab(name);
    perform('Loading changes…',async () => {
      setReview(await api('review'));
      setResolution(null);
      setPreviewChecked(false);
      setTab('Diff');
    });
  }
  function resolveConflict(change) {
    perform('Resolving conflict…',async () => {
      setReview(await api('resolve-conflict',{file:change.file,originalHash:change.originalHash,
        merged:resolution.text}));
      setResolution(null);
      await refreshDraft();
    });
  }
  function publish() {
    perform('Publishing…',async () => {
      try {
        await api('publish',{token:review.token,approved:previewChecked});
        setNotice({text:'Published changes to the original folder.'});
      } finally {
        await refreshDraft();
      }
    });
  }
  const changes = file ? diffLines(file.original,file.text) : [];
  const shownFiles = workspace?.files.filter(path => path.toLowerCase().includes(filter.toLowerCase())) || [];
  return <>
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Layers3 size={21}/></div><span>Open Studio</span><small>WORKSPACE</small></div>
      <div className="top-right"><span className="pill"><i/> Local workspace</span><span className="top-divider"/><span className="codex-mark"><Command size={16}/> Codex</span></div>
    </header>
    <main className="layout">
      <aside className="explorer" aria-label="Project explorer">
        <div className="panel-label"><span>EXPLORER</span><FolderOpen size={16}/></div>
        <div className="project"><div className="project-icon"><Braces size={18}/></div><div><strong>{workspace?.name || 'Vue workspace'}</strong><small>{workspace ? 'Private draft' : 'No folder imported'}</small></div></div>
        {workspace ? <>
          <label className="search"><Search size={15}/><input aria-label="Filter source files" placeholder="Filter files…" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
          <div className="file-list">{shownFiles.map(path => <button key={path} type="button" className={file?.file === path ? 'active' : ''} onClick={()=>choose(path)} disabled={!!busy} title={path}>
            <FileCode2 size={15}/><span>{path.split('/').at(-1)}</span>
          </button>)}{!shownFiles.length && <small>No matching files.</small>}</div>
          <button className="quiet explorer-action" onClick={close} disabled={!!busy}><Square size={14}/> Close draft</button>
        </> : <button className="quiet explorer-action" onClick={()=>setImportOpen(true)}><FolderOpen size={16}/> Import folder</button>}
        <div className="explorer-foot"><Terminal size={15}/><button className="text-button" onClick={()=>setLogOpen(!logOpen)}>Runtime log</button></div>
      </aside>
      <section className="canvas" aria-label="Editor workspace">
        <div className="canvas-toolbar">
          <div className="tabs" role="group" aria-label="Workspace view">{[['Preview',Globe2],['Source',Code2],['Diff',GitCompareArrows]].map(([name,Icon])=>
            <button key={name} className={tab === name ? 'active' : ''} aria-pressed={tab === name} onClick={()=>view(name)} disabled={!!busy}><Icon size={15}/>{name}{name === 'Diff' && changes.length > 0 && <i/>}</button>)}</div>
          <div className="view-actions">
            <button className="icon" aria-label="Desktop viewport" aria-pressed={device === 'desktop'} onClick={()=>setDevice('desktop')}><Monitor size={16}/></button>
            <button className="icon" aria-label="Mobile viewport" aria-pressed={device === 'mobile'} onClick={()=>setDevice('mobile')}><Smartphone size={16}/></button>
            {ready && <a className="icon" href={workspace.url} target="_blank" rel="noreferrer" aria-label="Open preview in a new tab"><ArrowUpRight size={17}/></a>}
          </div>
        </div>
        <div className="canvas-content">
          <div className={'preview-box '+device} hidden={tab !== 'Preview'}>
            {ready ? <>
              <div className="browserbar"><div className="dots" aria-hidden="true"><i/><i/><i/></div>
                <div><Globe2 size={13}/><span>{workspace.url}{route && route !== '/' ? route : ''}</span></div>
                <button className="quiet picker-button" aria-pressed={picking} disabled={dirty || !!busy || !route}
                  title={route ? undefined : 'Waiting for the preview to connect'}
                  onKeyDown={event=>{if (event.key === 'Escape' && picking) togglePicker(false);}}
                  onClick={()=>togglePicker(!picking)}><MousePointer2 size={15}/>{picking ? 'Cancel' : 'Select element'}</button></div>
              {picking && <div className="picker-instructions" role="status"><MousePointer2 size={15}/>
                <span>Click an element to give Codex its context.</span><kbd>Esc</kbd><span>to cancel</span></div>}
              <iframe ref={preview} title="Vue draft preview" src={workspace.url} onLoad={previewLoaded} sandbox="allow-scripts allow-same-origin allow-forms"/>
            </> : <EmptyPreview workspace={workspace} onImport={()=>setImportOpen(true)} onStart={start} busy={!!busy}/>}
          </div>
          {tab === 'Source' && <div className="source-box vscode-source">
            {file ? <>
              <div className="source-head"><FileCode2 size={16}/><span title={file.file}>{file.file}</span></div>
              <Suspense fallback={<div className="source-editor" role="status">Loading editor…</div>}>
                <SourceEditor key={file.file} value={editor} onChange={setEditor} disabled={!!busy}/>
              </Suspense>
              <div className="source-actions">
                <button className="primary" disabled={!dirty || !!busy || !!workspace?.pendingEdit} onClick={()=>save(editor)}><Check size={16}/>Save draft</button>
                <button className="quiet" disabled={!!busy} onClick={formatSource}>Format source</button>
                <button className="quiet" disabled={dirty || !!busy || !workspace?.canUndoAgent || !!workspace?.pendingEdit}
                  onClick={()=>perform('Undoing agent edit…',async () => {
                    await api('agent-undo'); await refreshDraft();
                  })}><Undo2 size={16}/>Undo agent edit</button>
                <button className="quiet" disabled={(!dirty && file.text === file.original) || !!busy || !!workspace?.pendingEdit} onClick={()=>save(file.original)}>Restore imported</button>
              </div>
            </> : <div className="empty-source"><Code2 size={28}/><h2>No file selected</h2><p>Open a preview page or select a Vue file in Explorer.</p></div>}
          </div>}
          {tab === 'Diff' && <div className="source-box">
            <div className="source-head"><GitCompareArrows size={16}/><span>Changes to publish</span></div>
            <div className="publish-review">
              {!review?.changes.length && <p>No saved changes to publish.</p>}
              {review?.changes.map(change => <details key={change.file} open={change.conflict || undefined}>
                <summary>{change.kind} · {change.file}{change.conflict && ' · Conflict'}</summary>
                {change.conflict && <p>The original file changed. Compare the versions and resolve the conflict.</p>}
                {change.binary ? <p>Binary or large file. Preview its effect before publishing.</p>
                  : <pre className="diff">{diffLines(change.before ?? '',change.after ?? '').map((line,index)=>
                    <span key={index} className={line.kind}>{line.text+'\n'}</span>)}</pre>}
                {change.conflict && resolution?.file !== change.file && <button className="quiet" disabled={!!busy}
                  onClick={()=>setResolution({file:change.file,text:change.after ?? null})}>Resolve conflict</button>}
                {resolution?.file === change.file && <div className="conflict-editor">
                  {!change.binary && <>
                    <label>Merged text<textarea value={resolution.text ?? ''} rows={8}
                      onChange={event=>setResolution({...resolution,text:event.target.value})}/></label>
                    <button className="quiet" onClick={()=>setResolution({...resolution,text:change.before})}>Use original</button>
                  </>}
                  {change.binary && <p>Keep the original file to resolve this conflict.</p>}
                  <button className="primary" disabled={!!busy} onClick={()=>change.binary
                    ? perform('Keeping original…',async () => {
                      await api('resolve-conflict',{file:change.file,originalHash:change.originalHash,keepOriginal:true});
                      setResolution(null); await refreshDraft();
                    }) : resolveConflict(change)}>{change.binary ? 'Keep original' : resolution.text === null ? 'Save deletion' : 'Save resolution'}</button>
                </div>}
              </details>)}
            </div>
            <div className="source-actions">
              <label className="consent"><input type="checkbox" checked={previewChecked} disabled={!ready || !!busy}
                onChange={event=>setPreviewChecked(event.target.checked)}/> I reviewed the diff and checked the live preview.</label>
              <button className="primary" disabled={!ready || !!busy || dirty || !previewChecked || !review?.changes.length ||
                review.changes.some(change=>change.conflict) || !!workspace?.pendingEdit} onClick={publish}>Publish to original folder</button>
            </div>
          </div>}
          {logOpen && <section className="log"><div><Terminal size={15}/> Runtime log<button className="icon" onClick={()=>setLogOpen(false)} aria-label="Close runtime log"><X size={15}/></button></div><pre>{workspace?.logs || 'The dev server has not written any output yet.'}</pre></section>}
        </div>
        <div className={'statusbar'+(notice?.error ? ' error' : '')} role="status"><span><i/>{previewProgress
          ? 'Copying dependencies (' + previewProgress.copied + '/' + previewProgress.total + ')'
          : workspace?.agentActivity || busy || notice?.text || workspace?.dependencyFallback || (ready ? 'Preview running' : 'Ready')}</span><span>Private draft</span></div>
      </section>
      <aside className="agent" aria-label="Codex page chat">
        <div className="agent-title"><div className="agent-icon"><Sparkles size={19}/></div><div><strong>Page agent</strong><small>Powered by Codex</small></div><span className="agent-badge">AI</span></div>
        <div className="page-context"><small>PAGE CONTEXT</small><span><Globe2 size={14}/>{route || 'Waiting for preview'}</span><p>{resolving ? 'Finding Vue source…' : target || (route ? 'Page context' : 'Open a page to connect its source.')}</p>
          {selection?.route === route && selection?.element && <div className="selection-context">
            <div><MousePointer2 size={14}/><code>&lt;{selection.element.tag}{selection.element.id && '#' + selection.element.id}&gt;</code>
              <button type="button" className="icon" aria-label="Clear selected element" onClick={()=>setSelection(null)}><X size={14}/></button></div>
            {selection.element.label && <p dir="auto">{selection.element.label}</p>}
            <p>{resolving ? 'Looking up the component…' : componentResolved ? 'Component attached' :
              target ? 'Element attached with page source' : 'Element attached. Select a Vue file in Explorer to add source.'}</p>
          </div>}</div>
        <div className="chat" ref={chatLog} role="log" aria-label="Page messages" tabIndex={0}
          onScroll={event=>{const log = event.currentTarget; followChat.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;}}>
          {!messages.length && !activity && <div className="chat-empty"><div><Sparkles size={20}/></div><h2>Make a change</h2><p>Describe what you want to see on this page. Codex edits your private draft so you can check the result live.</p></div>}
          {messages.map((message,index)=><article className={'message '+(message.author === 'You' ? 'user' : '')}
            key={JSON.stringify([index,message.author,message.route,message.text])}>
            <div className="message-meta"><strong>{message.author}</strong>{message.route && <span>{message.route}</span>}</div>
            {message.author === 'Codex' ? <AgentReply text={message.text}/> : <p dir="auto">{message.text}</p>}
            {message.question && <div className="agent-question">
              <h3><CircleHelp size={15} aria-hidden="true"/> Codex asks</h3>
              <p dir="auto">{message.question.text}</p>
              {message === latestMessage && !busy && !activity && !pending && message.route === route &&
                <div className="question-options" aria-label="Suggested replies" role="group">
                  {message.question.options.map(option => <button type="button" className="quiet" key={option}
                    disabled={Boolean(prompt.trim())}
                    onClick={()=>{setPrompt(option);document.getElementById('prompt')?.focus();}}>{option}</button>)}
                  <small>{prompt.trim() ? 'Your reply is in the composer.' : message.question.options.length
                    ? 'Choose a suggestion or write your own reply below.' : 'Write your reply below.'}</small>
                </div>}
            </div>}
          </article>)}
          {activity && <div className="agent-activity" role="status">
            <LoaderCircle size={16} aria-hidden="true"/><span>{activity}</span>
          </div>}
          {pending && <section className="message agent-question approval-card" aria-label="Edit approval">
            <h3><ShieldCheck size={16} aria-hidden="true"/> Approve proposed edits?</h3>
            <p>Review the files Codex wants to edit in the draft.</p>
            <ul>{pending.files.map(path => {
              const impact = pending.impacts.find(item => item.file === path);
              return <li key={path}><strong>{path}</strong>
                {impact && <p>{impact.routes.length ? 'Routes found · ' + impact.routes.join(', ') : 'Shared component · No routes could be traced.'}</p>}</li>;
            })}</ul>
            <div className="approval-actions">
              <button className="primary" disabled={!!busy} onClick={()=>decide(true)}>Approve edit</button>
              <button className="quiet" disabled={!!busy} onClick={()=>decide(false)}>Decline</button>
            </div>
          </section>}
        </div>
        <form className="composer" onSubmit={send}>
          {workspace && <details className="agent-settings" onToggle={event=>{if (event.currentTarget.open) loadModels();}}>
            <summary>
              <SlidersHorizontal size={16} aria-hidden="true"/>
              <span>Agent settings</span>
              <small>{selectedModel?.label || 'Codex default'}</small>
              <ChevronDown className="agent-settings-chevron" size={14} aria-hidden="true"/>
            </summary>
            <div className="agent-settings-fields">
              <label>Model<select value={model} disabled={!!busy || modelStatus !== 'ready'} onChange={event=>{setModel(event.target.value);setReasoningEffort('');}}>
                <option value="">Codex default</option>
                {models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
              </select></label>
              <label>Reasoning<select value={reasoningEffort} disabled={!!busy} onChange={event=>setReasoningEffort(event.target.value)}>
                <option value="">Model default</option>
                {(selectedModel?.efforts || ['low','medium','high','xhigh']).map(effort=><option key={effort} value={effort}>{effort}</option>)}
              </select></label>
              <label className="agent-settings-approvals">Ask before editing<select value={editApproval} disabled={!!busy} onChange={event=>setEditApproval(event.target.value)}>
                <option value="shared">Shared components</option><option value="all">Every draft edit</option>
              </select></label>
              <div className="agent-model-status" role="status">
                {modelStatus === 'loading' && <p>Loading models…</p>}
                {modelStatus === 'unsupported' && <p>Restart Open Studio and reload this page to load model choices.</p>}
                {modelStatus === 'failed' && <p>Couldn’t load model choices. You can still use Codex default.</p>}
              </div>
              {modelStatus === 'failed' && <button type="button" className="quiet agent-model-retry" onClick={loadModels}>Retry loading models</button>}
            </div>
          </details>}
          <div className="composer-input">
            <label htmlFor="prompt">Message Codex</label>
            <SkillPrompt value={prompt} onChange={setPrompt} loadSkills={loadSkills}/>
            <div className="composer-toolbar">
              <span id="composer-hint">{composerHint || <><kbd>\</kbd> Skills <span aria-hidden="true">·</span> <kbd>Ctrl</kbd> + <kbd>Enter</kbd> Send</>}</span>
              <button className="send" type="submit" aria-label="Send to Codex" disabled={!!composerHint || !prompt.trim()}><ArrowUp size={19}/></button>
            </div>
          </div>
          <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Share draft context and messages with Codex.</label>
        </form>
      </aside>
    </main>
    <dialog ref={dialog} onCancel={event=>busy ? event.preventDefault() : setImportOpen(false)}>
      <form onSubmit={importProject}>
        <div className="dialog-title"><div className="project-icon"><FolderOpen size={20}/></div><button type="button" className="icon" aria-label="Close import dialog" onClick={()=>setImportOpen(false)} disabled={!!busy}><X size={19}/></button></div>
        <h2>Import a Vue project</h2><p>Choose the local frontend folder that contains package.json and installed dependencies.</p>
        <label htmlFor="folder">Frontend folder</label>
        <button id="folder" className="quiet" type="button" autoFocus aria-describedby="selected-folder" onClick={browseForFolder} disabled={!!busy}>
          <FolderOpen size={16}/>{busy === 'Choosing folder…' ? busy : 'Choose folder'}
        </button>
        <output id="selected-folder" className="selected-folder" aria-live="polite">{folder || 'No folder selected'}</output>
        <label htmlFor="port">Preview port</label><input id="port" type="number" min="1024" max="65535" required value={port} onChange={e=>setPort(e.target.value)} disabled={!!busy}/>
        {notice?.error && <p className="form-error" role="alert">{notice.text}</p>}
        <button className="primary" disabled={!!busy || !folder}><FolderOpen size={16}/>{busy === 'Importing frontend…' ? busy : 'Create private draft'}</button>
      </form>
    </dialog>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
