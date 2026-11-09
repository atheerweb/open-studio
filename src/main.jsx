import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  ArrowRight, ArrowUpRight, Braces, Check, Code2, Command, FileCode2, FolderOpen,
  GitCompareArrows, Globe2, Layers3, Monitor,
  Play, Search, Send, Smartphone, Sparkles, Square, Terminal, Undo2, X
} from 'lucide-react';
import './studio.css';

async function api(action, values = {}) {
  const response = await fetch('/api/vue',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...values})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The workspace request failed.');
  return result;
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
  const [notice,setNotice] = useState(null);
  const [route,setRoute] = useState(null);
  const [pageFile,setPageFile] = useState(null);
  const [resolving,setResolving] = useState(false);
  const [manualRoute,setManualRoute] = useState(null);
  const [file,setFile] = useState(null);
  const [editor,setEditor] = useState('');
  const [lastEdit,setLastEdit] = useState(null);
  const [tab,setTab] = useState('Preview');
  const [device,setDevice] = useState('desktop');
  const [filter,setFilter] = useState('');
  const [logOpen,setLogOpen] = useState(false);
  const [prompt,setPrompt] = useState('');
  const [messages,setMessages] = useState([]);
  const [consent,setConsent] = useState(false);
  const preview = useRef(null);
  const dialog = useRef(null);
  const chatLog = useRef(null);
  const dirty = Boolean(file && editor !== file.text);
  const ready = workspace?.state === 'ready';
  const target = pageFile || (manualRoute === route ? file?.file : null);

  useEffect(() => {
    api('status').then(result => setWorkspace(result.workspace)).catch(error => setNotice({error:true,text:error.message}));
  },[]);
  useEffect(() => {
    if (importOpen && !dialog.current.open) dialog.current.showModal();
    if (!importOpen && dialog.current.open) dialog.current.close();
  },[importOpen]);
  useEffect(() => {
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  },[messages,busy]);
  useEffect(() => {
    if (!ready) return;
    const listen = event => {
      if (event.source !== preview.current?.contentWindow ||
          event.origin !== new URL(workspace.url).origin || event.data?.type !== 'studio-vue-route' ||
          typeof event.data.route !== 'string' || !/^\/(?!\/)[^?#\r\n]{0,499}$/.test(event.data.route)) return;
      setRoute(event.data.route);
    };
    window.addEventListener('message',listen);
    return () => window.removeEventListener('message',listen);
  },[ready,workspace?.url]);
  useEffect(() => {
    setPageFile(null);
    setManualRoute(null);
    if (!route) return;
    let active = true;
    setResolving(true);
    api('resolve',{route}).then(result => {
      if (active) setPageFile(result.file);
    }).catch(error => {
      if (active) setNotice({error:true,text:error.message});
    }).finally(() => {
      if (active) setResolving(false);
    });
    return () => {active = false;};
  },[route]);
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
  function importProject(event) {
    event.preventDefault();
    perform('Importing frontend…',async () => {
      setWorkspace((await api('import',{folder:folder.trim()})).workspace);
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
    if (!confirm('Stop the preview and discard this draft?')) return;
    perform('Closing draft…',async () => {
      await api('close');
      setWorkspace(null); setRoute(null); setPageFile(null); setManualRoute(null);
      setResolving(false); setLastEdit(null); setMessages([]); setConsent(false); setTab('Preview');
      openFile(null);
    });
  }
  function choose(name) {
    if (dirty && !confirm('Discard the unsaved changes in this editor?')) return;
    perform('Opening source…',async () => {
      openFile(await api('read',{file:name}));
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
  function send(event) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request || !target || !consent || resolving || dirty) return;
    setPrompt('');
    setMessages(previous => [...previous,{author:'You',route,text:request}]);
    perform('Codex is editing…',async () => {
      try {
        const result = await api('chat',{route,file:target,prompt:request,approved:true});
        openFile(result.file);
        if (result.changed) setLastEdit({file:result.file.file,hash:result.file.hash,text:result.previous});
        setMessages(previous => [...previous,{author:'Codex',route,text:result.message}]);
        setNotice({text:result.changed ? 'Draft updated. Review the diff.' : 'No source changes were made.'});
      } catch (error) {
        setMessages(previous => [...previous,{author:'Studio',route,text:error.message}]);
        throw error;
      }
    });
  }
  const canUndo = Boolean(file && !dirty && lastEdit?.file === file.file && lastEdit?.hash === file.hash);
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
            <button key={name} className={tab === name ? 'active' : ''} aria-pressed={tab === name} onClick={()=>setTab(name)}><Icon size={15}/>{name}{name === 'Diff' && changes.length > 0 && <i/>}</button>)}</div>
          <div className="view-actions">
            <button className="icon" aria-label="Desktop viewport" aria-pressed={device === 'desktop'} onClick={()=>setDevice('desktop')}><Monitor size={16}/></button>
            <button className="icon" aria-label="Mobile viewport" aria-pressed={device === 'mobile'} onClick={()=>setDevice('mobile')}><Smartphone size={16}/></button>
            {ready && <a className="icon" href={workspace.url} target="_blank" rel="noreferrer" aria-label="Open preview in a new tab"><ArrowUpRight size={17}/></a>}
          </div>
        </div>
        <div className="canvas-content">
          <div className={'preview-box '+device} hidden={tab !== 'Preview'}>
            {ready ? <>
              <div className="browserbar"><div className="dots"><i/><i/><i/></div><div><Globe2 size={13}/>{workspace.url}{route && route !== '/' ? route : ''}</div></div>
              <iframe ref={preview} title="Vue draft preview" src={workspace.url} sandbox="allow-scripts allow-same-origin allow-forms"/>
            </> : <EmptyPreview workspace={workspace} onImport={()=>setImportOpen(true)} onStart={start} busy={!!busy}/>}
          </div>
          {tab !== 'Preview' && <div className="source-box">
            {file ? <>
              <div className="source-head"><FileCode2 size={16}/><span title={file.file}>{file.file}</span></div>
              {tab === 'Source' ? <textarea className="editor" aria-label="Vue draft source" spellCheck={false} value={editor} onChange={e=>setEditor(e.target.value)} disabled={!!busy}/>
                : <pre className="diff">{changes.length ? changes.map((line,index)=><span key={index} className={line.kind}>{line.text+'\n'}</span>) : 'No saved changes.'}</pre>}
              <div className="source-actions">
                <button className="primary" disabled={!dirty || !!busy} onClick={()=>save(editor)}><Check size={16}/>Save draft</button>
                <button className="quiet" disabled={!canUndo || !!busy} onClick={()=>save(lastEdit.text)}><Undo2 size={16}/>Undo agent edit</button>
                <button className="quiet" disabled={(!dirty && file.text === file.original) || !!busy} onClick={()=>save(file.original)}>Restore imported</button>
              </div>
            </> : <div className="empty-source"><Code2 size={28}/><h2>No file selected</h2><p>Open a preview page or select a Vue file in Explorer.</p></div>}
          </div>}
          {logOpen && <section className="log"><div><Terminal size={15}/> Runtime log<button className="icon" onClick={()=>setLogOpen(false)} aria-label="Close runtime log"><X size={15}/></button></div><pre>{workspace?.logs || 'The dev server has not written any output yet.'}</pre></section>}
        </div>
        <div className={'statusbar'+(notice?.error ? ' error' : '')} role="status"><span><i/>{busy || notice?.text || (ready ? 'Preview running' : 'Ready')}</span><span>Draft only</span></div>
      </section>
      <aside className="agent" aria-label="Codex page chat">
        <div className="agent-title"><div className="agent-icon"><Sparkles size={19}/></div><div><strong>Page agent</strong><small>Powered by Codex</small></div><span className="agent-badge">AI</span></div>
        <div className="page-context"><small>PAGE CONTEXT</small><span><Globe2 size={14}/>{route || 'Waiting for preview'}</span><p>{resolving ? 'Finding Vue source…' : target || (route ? 'Select a Vue file in Explorer.' : 'Open a page to connect its source.')}</p></div>
        <div className="chat" ref={chatLog} role="log" aria-label="Page messages">
          {!messages.length && <div className="chat-empty"><div><Sparkles size={20}/></div><h2>Make a change</h2><p>Describe what you want to see on this page. Codex edits your private draft so you can check the result live.</p></div>}
          {messages.map((message,index)=><div className={'message '+(message.author === 'You' ? 'user' : '')} key={index}><small>{message.author} <span>{message.route}</span></small><p>{message.text}</p></div>)}
        </div>
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="prompt">Message Codex about this page</label>
          <div className="composer-input"><textarea id="prompt" rows="3" maxLength={2000} placeholder="Describe a change to this page…" value={prompt} onChange={e=>setPrompt(e.target.value)}/>
            <button className="send" aria-label="Send to Codex" disabled={!!busy || !route || !target || resolving || dirty || !consent || !prompt.trim()}><Send size={16}/></button></div>
          <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Send the selected Vue file and prompt to Codex.</label>
        </form>
      </aside>
    </main>
    <dialog ref={dialog} onCancel={()=>setImportOpen(false)}>
      <form onSubmit={importProject}>
        <div className="dialog-title"><div className="project-icon"><FolderOpen size={20}/></div><button type="button" className="icon" aria-label="Close import dialog" onClick={()=>setImportOpen(false)} disabled={!!busy}><X size={19}/></button></div>
        <h2>Import a Vue project</h2><p>Choose the local frontend folder that contains package.json and installed dependencies.</p>
        <label htmlFor="folder">Frontend folder</label><input id="folder" autoFocus required placeholder="D:\your-vue-project" value={folder} onChange={e=>setFolder(e.target.value)} disabled={!!busy}/>
        <label htmlFor="port">Preview port</label><input id="port" type="number" min="1024" max="65535" required value={port} onChange={e=>setPort(e.target.value)} disabled={!!busy}/>
        {notice?.error && <p className="form-error" role="alert">{notice.text}</p>}
        <button className="primary" disabled={!!busy}><FolderOpen size={16}/>{busy || 'Create private draft'}</button>
      </form>
    </dialog>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
