import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Code2, Command, FileCode2, Folder, FolderOpen,
  Database, Files, GitBranch, GitCompareArrows, Globe2, History, MessageCircle, Monitor, MousePointer2, Network, PanelRight, RefreshCw, SlidersHorizontal,
  Activity, CircleHelp, LoaderCircle, Minus, Play, Plus, Search, ShieldCheck, Smartphone, Sparkles, Square, Terminal, Undo2, Wrench, X
} from 'lucide-react';
import './studio.css';
import {DatabasePanel} from './database-panel.jsx';
import {ArchitecturePanel} from './architecture-panel.jsx';
import {SkillPrompt} from './skill-prompt.jsx';
import {Select} from './select.jsx';

const SourceEditor = lazy(() => import('./source-editor.jsx'));
const workspaceRole = window.location.hash === '#backend' ? 'backend' : 'frontend';
const isBackend = workspaceRole === 'backend';
document.title = 'Open Studio — ' + (isBackend ? 'Backend' : 'Frontend');

const gitGroups = [['staged','Staged Changes'],['unstaged','Changes'],['untracked','Untracked'],['committed','Local Commit Changes']];
const gitStatusNames = {A:'Added',M:'Modified',D:'Deleted',R:'Renamed',C:'Copied',T:'Type changed',U:'Conflict','?':'Untracked'};

function gitFiles(result,group) {
  if (!result?.available) return [];
  if (group === 'committed') return (result.committed || []).map(file=>({...file,localCommitRange:result.localCommitRange}));
  return group === 'untracked' ? result.untracked.map(path=>({path,status:'?'})) : result[group];
}

const generatingCommitMessage = 'Generating commit message…';

function GitChanges({result,selected,onSelect,onRefresh,onAction,onGenerate,message,setMessage,messageError,busy,locked,live,worktreeBlock}) {
  const [actionsOpen,setActionsOpen] = useState(false);
  const actionsButton = useRef(null);
  const messageInput = useRef(null);
  const staged = gitFiles(result,'staged');
  const changes = ['unstaged','untracked'].flatMap(group=>gitFiles(result,group).map(file=>({...file,group})));
  const committed = gitFiles(result,'committed');
  const hasConflicts = staged.some(file=>file.status === 'U');
  const canCommit = !locked && !!message.trim() && !hasConflicts && (staged.length > 0 || result?.mergeInProgress);
  const canPush = !locked && !!result?.branch && result.hasRemote && !result.mergeInProgress;
  const localBranches = result?.branches?.local || [];
  const remoteBranches = result?.branches?.remote || [];
  const currentRef = localBranches.includes(result?.branch) ? 'refs/heads/' + result.branch : '';
  const worktreeLocked = locked || Boolean(worktreeBlock);
  const generating = busy === generatingCommitMessage;
  const shortcut = /Mac/.test(navigator.platform) ? '⌘+Enter' : 'Ctrl+Enter';
  const messageHint = generating ? generatingCommitMessage
    : hasConflicts ? 'Resolve and stage the conflicting files.'
    : result?.mergeInProgress ? 'Enter a message to finish the merge.'
    : !staged.length ? 'Stage changes to commit or generate a message.'
    : 'The sparkle sends your staged diff to Codex.';
  return <>
    <div className="panel-label"><span>SOURCE CONTROL</span>
      <button className="icon" aria-label="Refresh Git changes" title="Refresh Git changes" onClick={onRefresh} disabled={!!busy}><RefreshCw size={15}/></button>
    </div>
    {result?.available && live && <form className="scm-controls" onSubmit={event=>{
      event.preventDefault();
      if (canCommit) onAction('git-commit');
    }}>
      <div className="scm-branch">
        <GitBranch size={15} aria-hidden="true"/>
        <Select aria-label="Switch Git branch" value={currentRef} title={result.branch || 'Detached HEAD'}
          disabled={worktreeLocked || result.mergeInProgress || localBranches.length + remoteBranches.length === 0}
          onChange={event=>onAction('git-switch',{ref:event.target.value})}>
          {!currentRef && <option value="" disabled>{result.branch || 'Detached HEAD'}</option>}
          {localBranches.length > 0 && <optgroup label="Local branches">
            {localBranches.map(branch=><option key={branch} value={'refs/heads/' + branch}>{branch}</option>)}
          </optgroup>}
          {remoteBranches.length > 0 && <optgroup label="Remote branches">
            {remoteBranches.map(branch=><option key={branch} value={'refs/remotes/' + branch}>{branch}</option>)}
          </optgroup>}
        </Select>
        <span title={result.canPull ? 'Pull from ' + result.upstream : 'The current branch needs an upstream to pull.'}>
          <button type="button" className="quiet scm-pull" disabled={worktreeLocked || result.mergeInProgress || !result.canPull}
            onClick={()=>onAction('git-pull',{branch:result.branch})}><ArrowDown size={14} aria-hidden="true"/> Pull</button>
        </span>
      </div>
      {worktreeBlock && <small>{worktreeBlock}</small>}
      <div className="scm-message">
        <textarea ref={messageInput} rows={2} maxLength={8000} value={message} readOnly={!!busy}
          aria-label="Commit message" aria-describedby="scm-message-hint" placeholder={'Message (' + shortcut + ')'}
          onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{
            if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canCommit) onAction('git-commit');
          }}/>
        <button type="button" className="icon scm-generate" aria-label="Generate commit message with Codex"
          title="Generate commit message with Codex from staged changes" aria-describedby="scm-message-hint"
          disabled={locked || !staged.length || hasConflicts} onClick={async ()=>{
            await onGenerate();
            messageInput.current?.focus();
          }}>
          {generating ? <LoaderCircle className="scm-spinner" size={15} aria-hidden="true"/> : <Sparkles size={15} aria-hidden="true"/>}
        </button>
      </div>
      <div className="scm-actions" onBlur={event=>{
        if (!event.currentTarget.contains(event.relatedTarget)) setActionsOpen(false);
      }} onKeyDown={event=>{
        if (event.key !== 'Escape' || !actionsOpen) return;
        event.stopPropagation();
        setActionsOpen(false);
        actionsButton.current?.focus();
      }}>
        <button type="submit" className="primary scm-commit" disabled={!canCommit}>
          <Check size={15} aria-hidden="true"/> Commit
        </button>
        <button type="button" ref={actionsButton} className="quiet scm-more" aria-label="More Git actions"
          title="More Git actions" aria-expanded={actionsOpen} aria-controls="scm-more-actions"
          disabled={!!busy} onClick={()=>setActionsOpen(open=>!open)}>
          <ChevronDown size={14} aria-hidden="true"/>
        </button>
        <div className="scm-popover" id="scm-more-actions" hidden={!actionsOpen}>
          <button type="button" disabled={!canPush} onClick={()=>{setActionsOpen(false);onAction('git-push');}}>
            <ArrowUp size={14} aria-hidden="true"/> Push
          </button>
          <button type="button" disabled={!canCommit || !canPush} onClick={()=>{setActionsOpen(false);onAction('git-commit-and-push');}}>
            <Check size={14} aria-hidden="true"/> Commit &amp; Push
          </button>
          {result.canMerge && !result.mergeInProgress && <button type="button" disabled={worktreeLocked}
            onClick={()=>{setActionsOpen(false);onAction('git-merge-upstream',{branch:result.branch});}}>
            <ArrowDown size={14} aria-hidden="true"/> Merge from Remote
          </button>}
          {result.mergeInProgress && <button type="button" disabled={worktreeLocked}
            onClick={()=>{setActionsOpen(false);onAction('git-abort-merge',{branch:result.branch});}}>
            <Undo2 size={14} aria-hidden="true"/> Abort Merge
          </button>}
          {!result.hasRemote && <small>No Git remote configured.</small>}
          {result.hasRemote && !result.branch && <small>Check out a branch to push.</small>}
        </div>
      </div>
      <small id="scm-message-hint" role="status">{messageHint}</small>
      {result.mergeInProgress && <small>Merge in progress. Resolve and stage conflicts, then commit, or choose Abort Merge.</small>}
      {messageError && <small className="scm-error" role="alert">{messageError}</small>}
    </form>}
    {!result ? <p className="scm-empty">{busy || 'Refresh to load Git changes.'}</p>
      : !result.available ? <p className="scm-empty">{result.reason || 'The open folder is outside a Git working tree.'}</p>
      : !staged.length && !changes.length && !committed.length ? <p className="scm-empty">No Git changes.</p>
      : <div className="scm-tree">{[['staged','Staged Changes',staged],['unstaged','Changes',changes],
        ['committed','Local Commit Changes',committed]].map(([kind,label,files])=>{
        if (!files.length) return null;
        const isStaged = kind === 'staged';
        const isCommitted = kind === 'committed';
        const verb = isStaged ? 'Unstage' : 'Stage';
        const StageIcon = isStaged ? Minus : Plus;
        return <div className="scm-group" key={label}>
          <details open>
            <summary><ChevronRight size={14} aria-hidden="true"/><span>{label}</span>
              <span className="scm-count" aria-label={files.length + ' files'}>{files.length}</span>
            </summary>
            {files.map(file=>{
              const group = file.group || kind;
              const slash = file.path.lastIndexOf('/');
              const current = selected?.group === group && selected.path === file.path;
              const discardLabel = (isCommitted ? 'Undo committed changes to ' : 'Discard changes to ') + file.path;
              return <div className="scm-row" key={file.path} data-current={current}>
                <button className="scm-file" disabled={!!busy} title={file.path} aria-current={current || undefined}
                  onClick={()=>onSelect(group,file)}>
                  <FileCode2 size={15} aria-hidden="true"/><span className="scm-name">{file.path.slice(slash+1)}</span>
                  {slash >= 0 && <span className="scm-directory">{file.path.slice(0,slash)}</span>}
                  <span className="scm-status" data-status={file.status} aria-label={gitStatusNames[file.status]}>{file.status === '?' ? 'U' : file.status}</span>
                </button>
                {live && !isStaged && file.status !== 'U' && <button type="button" className="icon scm-discard"
                  disabled={worktreeLocked || (isCommitted && result.mergeInProgress)}
                  title={discardLabel} aria-label={discardLabel}
                  onClick={()=>onAction('git-discard',{group,path:file.path,localCommitRange:file.localCommitRange})}>
                  <Undo2 size={15} aria-hidden="true"/>
                </button>}
                {live && !isCommitted && !(isStaged && file.status === 'U') && <button type="button" className="icon scm-stage" disabled={locked} title={verb + ' ' + file.path}
                  aria-label={verb + ' ' + file.path} onClick={()=>onAction(isStaged ? 'git-unstage' : 'git-stage',{group,path:file.path})}>
                  <StageIcon size={15} aria-hidden="true"/>
                </button>}
              </div>;
            })}
          </details>
          {live && !isCommitted && <button type="button" className="icon scm-stage-all" disabled={locked}
            title={verb + ' all changes'} aria-label={verb + ' all changes'}
            onClick={()=>onAction(isStaged ? 'git-unstage-all' : 'git-stage-all')}>
            <StageIcon size={15} aria-hidden="true"/>
          </button>}
        </div>;
      })}</div>}
  </>;
}

function GitPatch({result,selected,content}) {
  if (!selected) return <div className="empty-source scm-welcome"><GitCompareArrows size={28} aria-hidden="true"/>
    <h2>Git Diff</h2><p>{!result?.available
      ? result?.reason || 'The open folder is outside a Git working tree.'
      : gitGroups.some(([group])=>gitFiles(result,group).length)
        ? 'Select a file in Source Control to view its changes.' : 'No Git changes.'}</p></div>;
  const label = gitGroups.find(([group])=>group === selected.group)[1];
  let oldLine = null;
  let newLine = null;
  return <>
    <div className="source-head scm-path"><FileCode2 size={16} aria-hidden="true"/><span title={selected.path}>{selected.path}</span><small>{label}</small></div>
    {content?.text != null ? <pre className="scm-patch scm-new-file">{content.text}</pre>
      : content?.patch ? <pre className="scm-patch">{content.patch.replace(/\n$/,'').split('\n').map((line,index)=>{
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
          oldLine = Number(hunk[1]);
          newLine = Number(hunk[2]);
        }
        const inHunk = oldLine !== null && /^[ +\-]/.test(line);
        const kind = hunk ? 'hunk' : !inHunk ? 'meta' : line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context';
        return <span key={index} className={'scm-line '+kind}>
          <span className="scm-gutter" aria-hidden="true">{inHunk && kind !== 'add' ? oldLine++ : ''}</span>
          <span className="scm-gutter" aria-hidden="true">{inHunk && kind !== 'remove' ? newLine++ : ''}</span>
          <span>{line}{'\n'}</span>
        </span>;
      })}</pre> : <p className="scm-empty">{content?.message || 'No patch available for this file.'}</p>}
  </>;
}

async function api(action, values = {}) {
  const response = await fetch('/api/vue',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...values,workspace:workspaceRole})
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'The workspace request failed.'),{committed:result.committed});
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

const activityStates = {
  running: {label:'Running',icon:LoaderCircle},
  completed: {label:'Completed',icon:Check},
  failed: {label:'Failed',icon:X},
  interrupted: {label:'Interrupted',icon:Minus}
};

function AgentActivity({status,steps}) {
  const current = status && steps.findLast(step => step.state === 'running');
  const summary = current ? current.kind === 'command' ? 'Running command' : 'Using tool' : status;
  return <div className="agent-activity" data-live={Boolean(status)}>
    {status && <div className="agent-activity-current" role="status">
      <span className="activity-live-icon"><LoaderCircle size={17} aria-hidden="true"/></span>
      <div><span className="activity-eyebrow">Codex is working</span><strong>{summary}</strong>
        {current?.detail && <code dir="auto">{current.detail}</code>}
      </div>
    </div>}
    {steps.length > 0 && <details>
      <summary>
        <Activity size={15} aria-hidden="true"/>
        <span>Activity</span>
        <span className="activity-count">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
        <ChevronDown className="activity-chevron" size={14} aria-hidden="true"/>
      </summary>
      <ol>{steps.map(step => {
        const {label,icon:StateIcon} = activityStates[step.state] || activityStates.completed;
        const StepIcon = step.kind === 'command' ? Terminal : Wrench;
        return <li key={step.id} data-state={step.state}>
          <span className="activity-marker"><StepIcon size={14} aria-hidden="true"/></span>
          <div className="activity-step">
            <div className="activity-step-heading">
              <strong>{step.kind === 'command' ? 'Command' : 'Tool'}</strong>
              <span className="activity-state"><StateIcon size={12} aria-hidden="true"/>{label}</span>
            </div>
            {step.detail && <code dir="auto">{step.detail}</code>}
            {step.exitCode != null && <span className="activity-exit">Exit code {step.exitCode}</span>}
          </div>
        </li>;
      })}</ol>
    </details>}
  </div>;
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

function folderTree(paths) {
  const root = {folders:new Map(), files:[]};
  for (const path of paths) {
    const segments = path.split('/');
    const name = segments.pop();
    let folder = root;
    for (const segment of segments) {
      if (!folder.folders.has(segment)) folder.folders.set(segment,{folders:new Map(), files:[]});
      folder = folder.folders.get(segment);
    }
    folder.files.push({name,path});
  }
  return root;
}

function FileList({files, filter, active, onChoose, busy}) {
  const query = filter.trim().toLowerCase();
  const matches = query ? files.filter(path=>path.toLowerCase().includes(query)) : [];
  const row = (name,path) => <button key={path} type="button" className="file-row"
    aria-current={active === path ? 'true' : undefined} onClick={()=>onChoose(path)} disabled={busy} title={path}>
    <FileCode2 size={14} aria-hidden="true"/><span>{name}</span>
  </button>;
  const tree = folder => <>
    {[...folder.folders].map(([name,child])=><details key={name} open>
      <summary><ChevronRight size={12} aria-hidden="true"/><Folder size={14} aria-hidden="true"/><span>{name}</span></summary>
      <div className="folder-children">{tree(child)}</div>
    </details>)}
    {folder.files.map(({name,path})=>row(name,path))}
  </>;
  return <div className="file-list">
    <div hidden={!!query}>{tree(folderTree(files))}</div>
    {query && matches.map(path=>row(path,path))}
    {!(query ? matches.length : files.length) && <small>{query ? 'No matching files.' : 'No Vue files found.'}</small>}
  </div>;
}

function EmptyPreview({onImport, workspace, onStart, port, onPortChange, busy}) {
  const canPreview = workspace?.canPreview;
  return <div className="empty-preview">
    <div className="preview-intro">
      <span className="preview-kicker"><i aria-hidden="true"/>LOCAL WORKBENCH</span>
      <h1>{workspace ? (canPreview ? 'Your project is ready to run' : workspace.name) : 'Open a project folder'}</h1>
      <p>{workspace ? (canPreview ? 'Start the dev server to browse your app and give Codex the context of the page you are viewing.'
        : 'Open Source Control to review and commit changes. Live preview is available for Vue projects that use Vite.')
        : isBackend ? 'Open a Laravel project to explore its modules, business lifecycles, and system design.'
        : 'Edit and preview your Vue project locally, then review, commit, and push with Source Control.'}</p>
      {canPreview && <form className="preview-start" onSubmit={onStart}>
        <label htmlFor="preview-port">Preview port
          <input id="preview-port" type="number" min="1024" max="65535" required
            value={port} onChange={event=>onPortChange(event.target.value)} disabled={busy}/>
        </label>
        <button className="primary" type="submit" disabled={busy}>
          <Play size={16} aria-hidden="true"/>Start preview <ArrowRight size={16} aria-hidden="true"/>
        </button>
      </form>}
      {!workspace && <button className="primary" disabled={busy} onClick={onImport}>
        <FolderOpen size={17} aria-hidden="true"/>Open Folder <ArrowRight size={16} aria-hidden="true"/>
      </button>}
    </div>
    <svg className="preview-mark" viewBox="0 0 348 274" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="workbench-glass" x2="1" y2="1">
          <stop className="glass-highlight"/>
          <stop className="glass-base" offset="1"/>
        </linearGradient>
        <radialGradient id="workbench-shadow">
          <stop stopOpacity=".55"/>
          <stop offset="1" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="174" cy="232" rx="162" ry="39" fill="url(#workbench-shadow)"/>
      <path className="workbench-guide" d="M18 72v103m311-69v103M199 153v102" strokeDasharray="2 5"/>

      {/* Source layer */}
      <g transform="translate(0 98)">
        <path className="workbench-edge" d="m27 67 172 80 115-54v10l-115 54-172-80Z"/>
        <g transform="matrix(.86 .4 -.86 .4 142 13)">
          <rect className="workbench-plate" width="200" height="134"/>
          <path className="workbench-rule" d="M29 0v134M0 88h200"/>
          <path className="workbench-code" d="M42 99h24m9 0h29m-52 10h40m10 0h36m-86 10h22m9 0h53" strokeWidth="3"/>
          <path className="workbench-rule" d="M12 99h5m-5 10h5m-5 10h5"/>
        </g>
      </g>

      {/* Live preview layer */}
      <g transform="translate(0 49)">
        <path className="workbench-edge" d="m27 67 172 80 115-54v9l-115 54-172-80Z"/>
        <g transform="matrix(.86 .4 -.86 .4 142 13)">
          <rect className="workbench-plate" width="200" height="134"/>
          <rect className="workbench-tile" x="15" y="70" width="170" height="48" rx="6"/>
          <path className="workbench-trace" d="M27 105h34l17-16 14 10 21-18 23 24h36" strokeWidth="2"/>
          <circle className="workbench-signal" cx="113" cy="81" r="3"/>
        </g>
      </g>

      {/* Draft diff layer */}
      <path className="workbench-glass-edge" d="m27 67 172 80 115-54v7l-115 54-172-80Z"/>
      <g transform="matrix(.86 .4 -.86 .4 142 13)">
        <rect className="workbench-glass" width="200" height="134" fill="url(#workbench-glass)"/>
        <path className="workbench-rule" d="M0 23h200M32 23v111"/>
        <path className="workbench-trace" d="M12 12h4m6 0h4m6 0h4m121 0h27" strokeWidth="2"/>
        <rect className="workbench-tile" x="45" y="38" width="139" height="27" rx="5"/>
        <rect className="workbench-added" x="45" y="71" width="139" height="27" rx="5"/>
        <path className="workbench-code" d="M58 51h10m14 0h48m8 0h28M82 112h32m8 0h21" strokeWidth="3"/>
        <path className="workbench-trace" d="M58 85h10m-5-5v10m19-5h59m8 0h17" strokeWidth="3"/>
      </g>
      <path className="workbench-trace" d="m27 67 172 80 115-54M27 116l16 8m248 27 23-9M183 238l16 7 15-7"/>
      <circle className="workbench-signal" cx="199" cy="147" r="2.5"/>
      <circle className="workbench-signal" cx="314" cy="93" r="2.5"/>
    </svg>
  </div>;
}

function App() {
  const [workspace,setWorkspace] = useState(null);
  const [folder,setFolder] = useState('');
  const [importOpen,setImportOpen] = useState(false);
  const [port,setPort] = useState(isBackend ? '5175' : '5174');
  const [busy,setBusy] = useState('');
  const [agentTurn,setAgentTurn] = useState(null);
  const [previewProgress,setPreviewProgress] = useState(null);
  const [previewRevision,setPreviewRevision] = useState(0);
  const [notice,setNotice] = useState(null);
  const [route,setRoute] = useState(null);
  const [pageFile,setPageFile] = useState(null);
  const [resolving,setResolving] = useState(false);
  const [manualRoute,setManualRoute] = useState(null);
  const [file,setFile] = useState(null);
  const [editor,setEditor] = useState('');
  const [selection,setSelection] = useState(null);
  const [selectionInfo,setSelectionInfo] = useState(null);
  const [picking,setPicking] = useState(false);
  const [review,setReview] = useState(null);
  const [gitDiff,setGitDiff] = useState(null);
  const [gitFile,setGitFile] = useState(null);
  const [gitContent,setGitContent] = useState(null);
  const [commitMessage,setCommitMessage] = useState('');
  const [commitMessageError,setCommitMessageError] = useState('');
  const [resolution,setResolution] = useState(null);
  const [previewChecked,setPreviewChecked] = useState(false);
  const [tab,setTab] = useState('Preview');
  const [device,setDevice] = useState('desktop');
  const [filter,setFilter] = useState('');
  const [logOpen,setLogOpen] = useState(false);
  const [explorerOpen,setExplorerOpen] = useState(true);
  const [sidebar,setSidebar] = useState('explorer');
  const [agentOpen,setAgentOpen] = useState(true);
  const [historyOpen,setHistoryOpen] = useState(null);
  const [sessionPrompts,setSessionPrompts] = useState({});
  const [consent,setConsent] = useState(false);
  const [models,setModels] = useState([]);
  const [modelStatus,setModelStatus] = useState('idle');
  const [model,setModel] = useState('');
  const [reasoningEffort,setReasoningEffort] = useState('');
  const [editApproval,setEditApproval] = useState('shared');
  const preview = useRef(null);
  const pickerButton = useRef(null);
  const dialog = useRef(null);
  const chatLog = useRef(null);
  const followChat = useRef(true);
  const sessionHeading = useRef(null);
  const focusSessionHeading = useRef(false);
  const dirty = Boolean(file && editor !== file.text);
  const ready = workspace?.state === 'ready';
  const canPick = ready && !!route && !dirty && !busy;
  const selectedElement = selection?.route === route ? selection.element : null;
  const selectedSource = selectedElement && selectionInfo?.selection === selection ? selectionInfo.result : null;
  const usage = selectedSource?.usage;
  const elementName = selectedElement && '<' + selectedElement.tag +
    (selectedElement.id ? '#' + selectedElement.id : '') + '>';
  const messages = workspace?.messages || [];
  const sessionId = workspace?.activeSessionId;
  const sessionTitle = workspace?.sessions?.find(session=>session.id === sessionId)?.title;
  const prompt = sessionPrompts[sessionId] || '';
  const setPrompt = value => setSessionPrompts(prompts=>({...prompts,[sessionId]:value}));
  const target = (manualRoute === route ? file?.file : null) || pageFile;
  const selectedModel = models.find(item => item.id === model);
  const pending = workspace?.pendingEdit;
  const blockedEdits = pending?.blockedFiles || [];
  const latestMessage = messages.at(-1);
  const activity = workspace?.agentActivity || (agentTurn && (agentTurn.done ? 'Refreshing workspace…' : 'Starting Codex…'));
  const pollAgent = agentTurn ? !agentTurn.done : Boolean(workspace?.agentActivity);
  const locked = Boolean(busy || activity);
  const showHistory = Boolean(workspace?.sessions && !pending && !activity &&
    (historyOpen ?? workspace.sessions.some(session=>session.preview)));
  const composerHint = pending ? 'Review the proposed edits above.' : activity ? 'You can draft your next message while Codex works.'
    : busy ? 'Wait for the current workspace action to finish.' : !route ? 'Open a page in the preview to start.'
    : resolving ? 'Finding the page source…' : dirty ? 'Save your source changes before sending.'
    : !consent ? 'Enable sharing below to send.' : '';

  useEffect(() => {
    api('status').then(({workspace:opened})=>{
      setWorkspace(opened);
      if (opened?.architecture && !opened.canPreview) {
        setTab('Architecture');
        setAgentOpen(false);
      }
    }).catch(error => setNotice({error:true,text:error.message}));
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
    if (!pollAgent) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const result = await api('status');
        if (active) setWorkspace(result.workspace);
      } catch {}
    },500);
    return () => {active = false; clearInterval(timer);};
  },[pollAgent]);
  useEffect(() => {
    if (!agentTurn?.done || busy) return;
    perform('Refreshing workspace…',async () => {
      try {
        await refreshDraft();
        if (agentTurn.error) throw agentTurn.error;
      } finally {
        setAgentTurn(null);
      }
    });
  },[agentTurn,busy]);
  useEffect(() => {
    if (importOpen && !dialog.current.open) dialog.current.showModal();
    if (!importOpen && dialog.current.open) dialog.current.close();
  },[importOpen]);
  useEffect(() => {
    if (agentOpen && chatLog.current && followChat.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  },[agentOpen,showHistory,sessionId,messages.length,latestMessage,activity,workspace?.agentSteps,pending]);
  useEffect(() => {
    if (!focusSessionHeading.current) return;
    focusSessionHeading.current = false;
    sessionHeading.current?.focus({preventScroll:true});
  },[showHistory,sessionId]);
  useEffect(() => {
    if (!ready) return;
    const listen = event => {
      if (event.source !== preview.current?.contentWindow ||
          event.origin !== new URL(workspace.url).origin) return;
      if (event.data?.type === 'studio-vue-pick-cancel') {
        setPicking(false);
        pickerButton.current?.focus({preventScroll:true});
        return;
      }
      if (!['studio-vue-route','studio-vue-selection'].includes(event.data?.type) ||
          typeof event.data.route !== 'string' || !/^\/(?!\/)[^?#\r\n]{0,499}$/.test(event.data.route)) return;
      setRoute(event.data.route);
      if (event.data.type === 'studio-vue-selection') {
        setPicking(false);
        setManualRoute(null);
        setAgentOpen(true);
        setHistoryOpen(false);
        const element = Object.fromEntries(['tag','id','label','path'].map(key =>
          [key,typeof event.data.element?.[key] === 'string' ? event.data.element[key].slice(0,250) : '']));
        const markup = typeof event.data.markup === 'string' ? event.data.markup.slice(0,4001) : '';
        setSelection({route:event.data.route,component:typeof event.data.component === 'string'
          ? event.data.component.slice(0,2048) : null,componentName:typeof event.data.componentName === 'string'
          ? event.data.componentName.slice(0,160) : null,element,markup});
      }
    };
    window.addEventListener('message',listen);
    return () => window.removeEventListener('message',listen);
  },[ready,workspace?.url]);
  useEffect(() => {
    if (!picking) return;
    const cancel = () => {
      if (workspace?.url) preview.current?.contentWindow?.postMessage(
        {type:'studio-vue-pick',active:false},new URL(workspace.url).origin);
      setPicking(false);
    };
    if (!canPick || tab !== 'Preview') return cancel();
    const onKeyDown = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      cancel();
      pickerButton.current?.focus({preventScroll:true});
    };
    window.addEventListener('keydown',onKeyDown);
    return () => window.removeEventListener('keydown',onKeyDown);
  },[picking,canPick,tab,workspace?.url]);
  useEffect(() => {
    setPageFile(null);
    setSelectionInfo(null);
    if (!route) { setResolving(false); return; }
    let active = true;
    setResolving(true);
    const picked = selection?.route === route ? selection : null;
    api('resolve',{route,component:picked?.component,componentName:picked?.componentName,selection:!!picked}).then(result => {
      if (active) {
        setPageFile(result.file);
        if (picked) setSelectionInfo({selection:picked,result});
      }
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
    perform('Opening folder…',async () => {
      const {workspace:opened} = await api('open',{folder});
      setWorkspace(opened);
      const showArchitecture = opened.architecture && !opened.canPreview;
      setTab(showArchitecture ? 'Architecture' : 'Preview');
      if (showArchitecture) setAgentOpen(false);
      setFolder('');
      setImportOpen(false);
      setNotice({text:'Project opened.'});
    });
  }
  function start(event) {
    event.preventDefault();
    if (!confirm('Run npm run dev in this trusted project?')) return;
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
    if (dirty && !confirm('Close the folder and discard the unsaved text in this editor?')) return;
    perform('Closing folder…',async () => {
      await api('close');
      setWorkspace(null); setRoute(null); setPageFile(null); setManualRoute(null);
      setResolving(false); setSelection(null); setPicking(false); setReview(null); setGitDiff(null); setResolution(null);
      setGitFile(null); setGitContent(null); setCommitMessage(''); setCommitMessageError(''); setSidebar('explorer');
      setPreviewChecked(false); setConsent(false); setHistoryOpen(null); setSessionPrompts({}); setTab('Preview');
      openFile(null);
    });
  }
  function choose(name,{keepSelection = false} = {}) {
    if (keepSelection && dirty && file.file === name) {
      setTab('Source');
      return;
    }
    if (dirty && !confirm('Discard the unsaved changes in this editor?')) return;
    perform('Opening source…',async () => {
      openFile(await api('read',{file:name}));
      if (!keepSelection) {
        setSelection(null);
        setManualRoute(route);
      }
      setTab('Source');
    });
  }
  function save(text) {
    perform('Saving source…',async () => {
      openFile(await api('write',{file:file.file,hash:file.hash,text}));
      setNotice({text:'File saved.'});
    });
  }
  function formatSource() {
    perform('Formatting source…',async () => {
      const result = await api('format-source',{file:file.file,text:editor});
      setEditor(result.text);
      setNotice({text:result.text === editor ? 'Source is already formatted.' : 'Source formatted. Save to apply the formatting.'});
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
  function selectSession(id) {
    perform('Opening chat session…',async () => {
      const result = await api('agent-session',{sessionId:id});
      followChat.current = true;
      focusSessionHeading.current = true;
      setWorkspace(result.workspace);
      setHistoryOpen(false);
    });
  }
  async function send(event) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request || composerHint) return;
    followChat.current = true;
    setHistoryOpen(false);
    setPrompt('');
    setNotice(null);
    setAgentTurn({done:false});
    let error;
    try {
      await api('agent-turn',{sessionId,route,file:target,element:selection?.route === route ? selection.element : null,prompt:request,approved:true,
        model:model || undefined,reasoningEffort:reasoningEffort || undefined,editApproval});
    } catch (failure) {
      error = failure;
    }
    setAgentTurn({done:true,error});
  }
  async function refreshDraft(updatedWorkspace) {
    updatedWorkspace ??= (await api('status')).workspace;
    setWorkspace(updatedWorkspace);
    if (file) openFile(updatedWorkspace.files.includes(file.file) ? await api('read',{file:file.file}) : null);
    if (tab === 'Publish') setReview(await api('review'));
    setPreviewChecked(false);
  }
  function decide(approved,revise = false) {
    perform(approved ? 'Applying edits…' : 'Closing proposal…',async () => {
      await api('agent-approval',{id:pending.id,approved,revise});
      await refreshDraft();
      if (revise) {
        setPrompt(current => current.trim() ? current :
          'Re-read the current files and revise your last proposal using exact, unique matches for the edits.');
        document.getElementById('prompt')?.focus();
      }
    });
  }
  function togglePicker(active) {
    preview.current?.contentWindow?.postMessage({type:'studio-vue-pick',active},new URL(workspace.url).origin);
    setPicking(active);
  }
  function refreshPreview() {
    if (route) {
      preview.current?.contentWindow?.postMessage({type:'studio-vue-reload'},new URL(workspace.url).origin);
    } else {
      setPreviewRevision(revision=>revision + 1);
    }
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
    if (!workspace || !['Diff','Publish'].includes(name)) return setTab(name);
    if (name === 'Diff') {
      return perform('Loading Git changes…',async () => {
        setSidebar('git');
        setExplorerOpen(true);
        setTab(name);
        await refreshGit();
      });
    }
    perform('Loading draft review…',async () => {
      setReview(await api('review'));
      setResolution(null);
      setPreviewChecked(false);
      setTab(name);
    });
  }
  async function refreshGit() {
    const result = await api('git-diff');
    setCommitMessageError('');
    const changes = gitGroups.flatMap(([group])=>gitFiles(result,group).map(change=>({...change,group})));
    const selection = changes.find(change=>change.group === gitFile?.group && change.path === gitFile.path)
      || changes.find(change=>change.path === gitFile?.path)
      || changes.find(change=>change.path === file?.file && change.group === 'unstaged')
      || changes.find(change=>change.path === file?.file)
      || changes[0] || null;
    setGitDiff(result);
    setGitContent(null);
    setGitFile(selection);
    if (selection) setGitContent(await api('git-file',selection));
  }
  function generateCommitMessage() {
    return perform(generatingCommitMessage,async () => {
      setCommitMessageError('');
      try {
        const {message} = await api('git-generate-message',{approved:true});
        setCommitMessage(message);
      } catch (error) {
        setCommitMessageError(error.message);
      }
    });
  }
  function gitAction(action,values = {}) {
    const combined = action === 'git-commit-and-push';
    const discard = action === 'git-discard';
    const abortMerge = action === 'git-abort-merge';
    const changesTree = discard || ['git-switch','git-pull','git-merge-upstream','git-abort-merge'].includes(action);
    if (changesTree && (dirty || pending)) return;
    if (abortMerge && !confirm('Abort the merge and discard any work done to resolve it?')) return;
    if (discard) {
      const questions = {
        committed:'Undo local committed changes to "' + values.path + '"? Review, stage, and commit the resulting change before pushing.',
        untracked:'Permanently delete the untracked file "' + values.path + '"?',
        unstaged:'Discard unstaged changes to "' + values.path + '"? Any staged changes will be kept.'
      };
      const question = questions[values.group];
      if (!confirm(question)) return;
    }
    const labels = {'git-stage':'Staging file','git-unstage':'Unstaging file','git-commit':'Committing',
      'git-stage-all':'Staging all changes','git-unstage-all':'Unstaging all changes',
      'git-push':'Pushing','git-commit-and-push':'Committing and pushing',
      'git-switch':'Switching branches','git-pull':'Pulling','git-discard':'Discarding changes',
      'git-merge-upstream':'Merging from remote','git-abort-merge':'Aborting merge'};
    const worktreeNotices = {'git-switch':'Branch switched.','git-pull':'Pull complete.',
      'git-discard':values.group === 'committed' ? 'Undo ready to review, stage, and commit.' : 'Changes discarded.',
      'git-merge-upstream':'Remote changes merged. Push when ready.','git-abort-merge':'Merge aborted.'};
    perform(labels[action] + '…',async () => {
      try {
        if (combined || action === 'git-commit') {
          await api(action,{message:commitMessage});
          setCommitMessage('');
          setNotice({text:combined ? 'Commit pushed.' : 'Commit created.'});
        } else {
          const result = await api(action,discard || abortMerge ? {...values,approved:true} : values);
          if (changesTree) {
            await refreshDraft(result.workspace);
            setSelection(null);
            if (ready) refreshPreview();
            setNotice({text:worktreeNotices[action]});
          }
          if (action === 'git-push') setNotice({text:'Branch pushed.'});
        }
      } catch (error) {
        if (error.committed) setCommitMessage('');
        if (changesTree) await refreshDraft().catch(() => {});
        await refreshGit().catch(() => {});
        throw error;
      }
      await refreshGit();
    });
  }
  function openGitFile(group,file) {
    perform('Loading file diff…',async () => {
      const selection = {...file,group};
      setGitContent(await api('git-file',selection));
      setGitFile(selection);
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
  const views = [['Preview',Globe2],['Database',Database]];
  if (workspace?.architecture) views.splice(1,0,['Architecture',Network]);
  if (workspace && !workspace.live) views.push(['Publish',ArrowUpRight]);
  return <>
    <header className="topbar">
      <div className="brand">
        <div className="brand-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
            <path d="M10 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h3m4-16h3a3 3 0 0 1 3 3v2m0 6v2a3 3 0 0 1-3 3h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="12" r="2.75" fill="currentColor"/>
          </svg>
        </div>
        <span>Open Studio</span>
      </div>
      <div className="workspace-path">
        <span className="workspace-label">{isBackend ? 'BACKEND' : 'FRONTEND'}</span><span title={workspace?.name}>{workspace?.name || 'Workspace'}</span>
      </div>
      <div className="top-right">
        <a className="workspace-window" href={isBackend ? '/' : '/#backend'} target="_blank" rel="noopener"
          aria-label={isBackend ? 'Open Frontend in another window' : 'Open Backend in another window'}>
          <span>{isBackend ? 'Open Frontend' : 'Open Backend'}</span><ArrowUpRight size={14} aria-hidden="true"/>
        </a>
        <div className="panel-controls" role="group" aria-label="Workspace panels">
          <button type="button" className="panel-toggle" aria-label="Agent Chat" aria-controls="agent-chat"
            aria-expanded={agentOpen} onClick={()=>setAgentOpen(open=>!open)}>
            <PanelRight size={17} aria-hidden="true"/><span>Agent Chat</span>
          </button>
        </div>
      </div>
    </header>
    <main className="layout" data-explorer-open={explorerOpen} data-agent-open={agentOpen}>
      <nav className="activity-bar" aria-label="Workspace activity">
        <button className="activity-button" title="Explorer" aria-label="Explorer" aria-controls="workspace-sidebar"
          aria-expanded={explorerOpen && sidebar === 'explorer'} onClick={()=>{
            setExplorerOpen(sidebar !== 'explorer' || !explorerOpen);
            setSidebar('explorer');
          }}><Files size={22} aria-hidden="true"/></button>
        <button className="activity-button" title="Source Control" aria-label="Source Control" aria-controls="workspace-sidebar"
          aria-expanded={explorerOpen && sidebar === 'git'} disabled={!workspace || !!busy}
          onClick={()=>sidebar === 'git' && explorerOpen && tab === 'Diff' ? setExplorerOpen(false) : view('Diff')}>
          <GitBranch size={22} aria-hidden="true"/>
        </button>
      </nav>
      <aside id="workspace-sidebar" className="explorer" aria-label={sidebar === 'git' ? 'Source Control' : 'Project explorer'}
        inert={!explorerOpen} aria-hidden={!explorerOpen}>
        {sidebar === 'git' ? <GitChanges result={gitDiff} selected={gitFile} onSelect={openGitFile}
          onRefresh={()=>perform('Refreshing Git changes…',refreshGit)} onAction={gitAction} onGenerate={generateCommitMessage}
          message={commitMessage} setMessage={message=>{setCommitMessage(message);setCommitMessageError('');}}
          messageError={commitMessageError} busy={busy} locked={locked} live={workspace?.live}
          worktreeBlock={dirty ? 'Save your source changes before changing the working tree.'
            : pending ? 'Resolve the pending edit before changing the working tree.' : ''}/> : <>
        <div className="panel-label"><span>EXPLORER</span><FolderOpen size={15} aria-hidden="true"/></div>
        <div className="project"><FolderOpen size={15} aria-hidden="true"/><strong title={workspace?.name}>{workspace?.name || 'No folder open'}</strong></div>
        {workspace ? <>
          <label className="search"><Search size={15}/><input aria-label="Filter source files" placeholder="Filter files…" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
          <FileList files={workspace.files} filter={filter} active={file?.file} onChoose={choose} busy={!!busy}/>
          <button className="quiet explorer-action" onClick={close} disabled={locked}><Square size={14}/> Close folder</button>
        </> : <button className="quiet explorer-action" onClick={()=>setImportOpen(true)}><FolderOpen size={16}/> Open Folder</button>}
        <div className="explorer-foot"><Terminal size={15}/><button className="text-button" onClick={()=>setLogOpen(!logOpen)}>Runtime log</button></div>
        </>}
      </aside>
      <section className="canvas" aria-label="Editor workspace">
        <div className="canvas-toolbar">
          <div className="tabs" role="group" aria-label="Workspace view">{views.map(([name,Icon])=>
            <button key={name} className={tab === name ? 'active' : ''} aria-pressed={tab === name} onClick={()=>view(name)} disabled={!!busy}><Icon size={15} aria-hidden="true"/>{name}</button>)}</div>
          {tab !== 'Database' && tab !== 'Architecture' && <div className="view-actions">
            {ready && tab === 'Preview' && <button type="button" className="icon" aria-label="Refresh preview"
              title="Refresh preview" onClick={refreshPreview}><RefreshCw size={16} aria-hidden="true"/></button>}
            <button className="icon" aria-label="Desktop viewport" aria-pressed={device === 'desktop'} onClick={()=>setDevice('desktop')}><Monitor size={16}/></button>
            <button className="icon" aria-label="Mobile viewport" aria-pressed={device === 'mobile'} onClick={()=>setDevice('mobile')}><Smartphone size={16}/></button>
            {ready && <a className="icon" href={workspace.url} target="_blank" rel="noreferrer" aria-label="Open preview in a new tab"><ArrowUpRight size={17}/></a>}
          </div>}
        </div>
        <div className="canvas-content">
          <div className={'preview-box '+device} data-picking={picking} hidden={tab !== 'Preview'}>
            {ready ? <>
              <div className="browserbar"><div className="dots" aria-hidden="true"><i/><i/><i/></div>
                <div><Globe2 size={13}/><span>{workspace.url}{route && route !== '/' ? route : ''}</span></div>
                <button ref={pickerButton} className="quiet picker-button" aria-pressed={picking} disabled={!canPick}
                  aria-describedby={picking ? 'picker-guide' : undefined}
                  title={dirty ? 'Save your source changes first' : !route ? 'Waiting for the preview to connect' : undefined}
                  onClick={()=>togglePicker(!picking)}>
                  {picking ? <X size={15} aria-hidden="true"/> : <MousePointer2 size={15} aria-hidden="true"/>}
                  {picking ? 'Cancel selection' : selectedElement ? 'Pick again' : 'Select element'}
                </button></div>
              <div className="preview-frame">
                <iframe key={previewRevision} ref={preview} title="Vue project preview" src={workspace.url} onLoad={previewLoaded} sandbox="allow-scripts allow-same-origin allow-forms"/>
                <div className="picker-guide" id="picker-guide" aria-hidden={!picking}>
                  <MousePointer2 size={17} aria-hidden="true"/>
                  <span><strong>Pick an element</strong><small>Click or tap, or press Tab then Enter.</small></span>
                  <kbd>Esc</kbd>
                </div>
              </div>
            </> : <EmptyPreview workspace={workspace} onImport={()=>setImportOpen(true)} onStart={start}
              port={port} onPortChange={setPort} busy={locked}/>}
          </div>
          <DatabasePanel api={api} hidden={tab !== 'Database'}/>
          {workspace?.architecture && <ArchitecturePanel api={api} hidden={tab !== 'Architecture'} projectName={workspace.name}/>}
          {tab === 'Source' && <div className="source-box draft-source">
            {file ? <>
              <div className="source-head">
                <FileCode2 size={16} aria-hidden="true"/>
                <span className="source-path" title={file.file}>{file.file}</span>
                <small className={dirty ? 'source-state dirty' : 'source-state'}>{dirty ? 'Unsaved' : 'Saved'}</small>
              </div>
              <Suspense fallback={<div className="source-editor" role="status">Loading editor…</div>}>
                <SourceEditor key={file.file} value={editor} onChange={setEditor} disabled={locked}/>
              </Suspense>
              <div className="source-actions">
                <button className="primary" disabled={!dirty || locked || !!workspace?.pendingEdit} onClick={()=>save(editor)}><Check size={16}/>Save file</button>
                <button className="quiet" disabled={locked} onClick={formatSource}>Format source</button>
                <button className="quiet" disabled={dirty || locked || !workspace?.canUndoAgent || !!workspace?.pendingEdit}
                  onClick={()=>perform('Undoing agent edit…',async () => {
                    await api('agent-undo'); await refreshDraft();
                  })}><Undo2 size={16}/>Undo agent edit</button>
                {!workspace?.live && <button className="quiet" disabled={(!dirty && file.text === file.original) || locked || !!workspace?.pendingEdit} onClick={()=>save(file.original)}>Restore imported</button>}
              </div>
            </> : <div className="empty-source"><Code2 size={28}/><h2>No file selected</h2><p>Open a preview page or select a Vue file in Explorer.</p></div>}
          </div>}
          {tab === 'Diff' && <div className="source-box">
            {workspace ? <GitPatch result={gitDiff} selected={gitFile} content={gitContent}/>
              : <div className="empty-source"><GitCompareArrows size={28}/><h2>Git Diff</h2><p>Open a project to see its Git changes.</p></div>}
          </div>}
          {tab === 'Publish' && <div className="source-box">
            <div className="source-head"><GitCompareArrows size={16}/><span>Changes to publish</span></div>
            <div className="change-list">
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
                  <button className="primary" disabled={locked} onClick={()=>change.binary
                    ? perform('Keeping original…',async () => {
                      await api('resolve-conflict',{file:change.file,originalHash:change.originalHash,keepOriginal:true});
                      setResolution(null); await refreshDraft();
                    }) : resolveConflict(change)}>{change.binary ? 'Keep original' : resolution.text === null ? 'Save deletion' : 'Save resolution'}</button>
                </div>}
              </details>)}
            </div>
            <div className="source-actions">
              <label className="consent"><input type="checkbox" checked={previewChecked} disabled={!ready || locked}
                onChange={event=>setPreviewChecked(event.target.checked)}/> I reviewed the diff and checked the live preview.</label>
              <button className="primary" disabled={!ready || locked || dirty || !previewChecked || !review?.changes.length ||
                review.changes.some(change=>change.conflict) || !!workspace?.pendingEdit} onClick={publish}>Publish to original folder</button>
            </div>
          </div>}
          {logOpen && <section className="log"><div><Terminal size={15}/> Runtime log<button className="icon" onClick={()=>setLogOpen(false)} aria-label="Close runtime log"><X size={15}/></button></div><pre>{workspace?.logs || 'The dev server has not written any output yet.'}</pre></section>}
        </div>
        <div className={'statusbar'+(notice?.error ? ' error' : '')} role="status"><span><i/>{previewProgress
          ? 'Copying dependencies (' + previewProgress.copied + '/' + previewProgress.total + ')'
          : activity || busy || notice?.text || (picking ? 'Element picker active' :
            elementName ? 'Element attached to Agent Chat' : workspace?.dependencyFallback || (ready ? 'Preview running' : 'Ready'))}</span>
          <span className="status-mode"><ShieldCheck size={13} aria-hidden="true"/>{workspace?.live ? 'Working tree' : workspace ? 'Private draft' : 'Local workspace'}</span></div>
      </section>
      <aside id="agent-chat" className="agent" aria-label="Codex page chat"
        inert={!agentOpen} aria-hidden={!agentOpen}>
        <div className="agent-title"><MessageCircle size={16} aria-hidden="true"/><strong>Agent Chat</strong><span className="agent-badge"><Command size={12} aria-hidden="true"/> CODEX</span></div>
        {workspace?.sessions && (showHistory ? <>
          <div className="session-toolbar">
            <h2 ref={sessionHeading} tabIndex={-1}>Chat history</h2>
            <button type="button" className="quiet" disabled={!!busy} onClick={()=>selectSession(null)}>
              <Plus size={15} aria-hidden="true"/>New session
            </button>
          </div>
          <ul className="session-list" aria-label="Chat sessions">
            {workspace.sessions.toReversed().map(({id,title,preview})=><li key={id}>
              <button type="button" className="quiet session-card" aria-current={id === sessionId ? 'true' : undefined}
                disabled={!!busy} onClick={()=>selectSession(id)}>
                <span className="session-card-icon"><MessageCircle size={16} aria-hidden="true"/></span>
                <span className="session-card-copy">
                  <strong dir="auto" title={title}>{title}</strong>
                  <small dir="auto">{preview || 'No messages yet'}</small>
                </span>
                <ChevronRight size={15} className="session-card-arrow" aria-hidden="true"/>
              </button>
            </li>)}
          </ul>
        </> : <div className="session-toolbar">
          <button type="button" className="quiet session-icon-button" aria-label="Chat history" title="Chat history"
            disabled={!!busy || !!pending || !!activity} onClick={()=>{
              focusSessionHeading.current = true;
              setHistoryOpen(true);
            }}>
            <History size={17} aria-hidden="true"/>
          </button>
          <h2 ref={sessionHeading} tabIndex={-1} dir="auto" title={sessionTitle}>{sessionTitle}</h2>
          <button type="button" className="quiet session-icon-button" aria-label="New session" title="New session"
            disabled={!!busy || !!pending || !!activity} onClick={()=>selectSession(null)}>
            <Plus size={17} aria-hidden="true"/>
          </button>
        </div>)}
        {!showHistory && <div className="page-context"><small>PAGE CONTEXT</small><span><Globe2 size={14}/>{route || 'Waiting for preview'}</span><p>{resolving ? 'Finding Vue source…' : target || (route ? 'Page context' : 'Open a page to connect its source.')}</p>
          {selectedElement && <div className="selection-context">
            <div><Check size={14} aria-hidden="true"/><code title={elementName}>{elementName}</code>
              <button type="button" className="icon" aria-label="Clear selected element" onClick={()=>setSelection(null)}><X size={15} aria-hidden="true"/></button></div>
            {selectedElement.label && <p dir="auto">{selectedElement.label}</p>}
            <p role="status">{resolving ? 'Looking up the component…' : usage
              ? `${usage.pages} traced ${usage.pages === 1 ? 'page' : 'pages'} · ${usage.files} referencing Vue ${usage.files === 1 ? 'file' : 'files'}`
              : selectedSource?.componentResolved ? 'Component usage unavailable' :
                selectedSource?.file ? 'Element attached with page source' : 'Vue source unavailable for this element.'}</p>
            {selection.markup && <details className="selection-markup" key={selection.markup}>
              <summary>Rendered HTML</summary>
              <pre tabIndex={0} aria-label="Selected element HTML"><code>{selection.markup.length > 4000
                ? selection.markup.slice(0,4000) + '…' : selection.markup}</code></pre>
            </details>}
            {selectedSource?.file && <button type="button" className="quiet selection-source" disabled={!!busy}
              onClick={()=>choose(selectedSource.file,{keepSelection:true})}>
              <FileCode2 size={14} aria-hidden="true"/>{selectedSource.componentResolved ? 'Open component source' : 'Open page source'}
            </button>}
          </div>}</div>}
        {!showHistory && <div className="chat" ref={chatLog} role="log" aria-label="Page messages" tabIndex={0}
          onScroll={event=>{const log = event.currentTarget; followChat.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;}}>
          {!messages.length && !activity && <div className="chat-empty">
            <div className="chat-avatar"><Sparkles size={17} aria-hidden="true"/></div>
            <section><h2>What would you like to change?</h2><p>Describe an edit and review the changes in your project.</p></section>
          </div>}
          {messages.map((message,index)=><article className={'message '+(message.author === 'You' ? 'user' : '')}
            key={JSON.stringify([index,message.author,message.route,message.text])}>
            {message.activity?.length > 0 && <AgentActivity steps={message.activity}/>}
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
          {activity && <AgentActivity status={activity} steps={workspace?.agentSteps || []}/>}
          {pending && <section className="message agent-question approval-card" aria-label="Edit approval">
            <h3><ShieldCheck size={16} aria-hidden="true"/> Review proposed edits</h3>
            <p>{blockedEdits.length ? 'Some files need a revised edit before Studio can apply them.' : 'Review the files Codex wants to edit.'}</p>
            <ul>{pending.files.map(path => {
              const impact = pending.impacts.find(item => item.file === path);
              return <li key={path}><strong>{path}</strong>
                {blockedEdits.length > 0 && <p>Ready to apply</p>}
                {impact && <p>{impact.routes.length ? 'Routes found · ' + impact.routes.join(', ') : 'Shared component · No routes could be traced.'}</p>}</li>;
            })}{blockedEdits.map(({file,reason}) => <li key={file}><strong>{file}</strong>
              <p>Needs revision · {reason}</p>
            </li>)}</ul>
            <div className="approval-actions">
              {pending.files.length > 0 && <button className="primary" disabled={locked} onClick={()=>decide(true)}>
                {blockedEdits.length ? 'Apply matching edits' : 'Approve edit'}
              </button>}
              {blockedEdits.length > 0 && <button className={pending.files.length ? 'quiet' : 'primary'}
                disabled={locked} onClick={()=>decide(false,true)}>Revise proposal</button>}
              <button className="quiet" disabled={locked} onClick={()=>decide(false)}>{pending.files.length ? 'Decline' : 'Dismiss'}</button>
            </div>
          </section>}
        </div>}
        {!showHistory && <form className="composer" onSubmit={send}>
          {workspace && <details className="agent-settings" onToggle={event=>{if (event.currentTarget.open) loadModels();}}>
            <summary>
              <SlidersHorizontal size={16} aria-hidden="true"/>
              <span>Agent settings</span>
              <small>{selectedModel?.label || 'Codex default'}</small>
              <ChevronDown className="agent-settings-chevron" size={14} aria-hidden="true"/>
            </summary>
            <div className="agent-settings-fields">
              <label>Model<Select value={model} disabled={!!busy || modelStatus !== 'ready'} onChange={event=>{setModel(event.target.value);setReasoningEffort('');}}>
                <option value="">Codex default</option>
                {models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
              </Select></label>
              <label>Reasoning<Select value={reasoningEffort} disabled={!!busy} onChange={event=>setReasoningEffort(event.target.value)}>
                <option value="">Model default</option>
                {(selectedModel?.efforts || ['low','medium','high','xhigh']).map(effort=><option key={effort} value={effort}>{effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1)}</option>)}
              </Select></label>
              <label className="agent-settings-approvals">Ask before editing<Select value={editApproval} disabled={!!busy} onChange={event=>setEditApproval(event.target.value)}>
                <option value="shared">Shared components</option><option value="all">Every edit</option>
              </Select></label>
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
            <SkillPrompt key={sessionId} value={prompt} onChange={setPrompt} loadSkills={loadSkills}/>
            <div className="composer-toolbar">
              <span id="composer-hint">{composerHint || <><kbd>\</kbd> Skills <span aria-hidden="true">·</span> <kbd>Ctrl</kbd> + <kbd>Enter</kbd> Send</>}</span>
              <button className="send" type="submit" aria-label="Send to Codex" disabled={!!composerHint || !prompt.trim()}><ArrowUp size={19}/></button>
            </div>
          </div>
          <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Share project context and messages with Codex.</label>
        </form>}
      </aside>
    </main>
    <dialog ref={dialog} onCancel={event=>busy ? event.preventDefault() : setImportOpen(false)}>
      <form onSubmit={importProject}>
        <div className="dialog-title"><div className="project-icon"><FolderOpen size={20}/></div><button type="button" className="icon" aria-label="Close folder dialog" onClick={()=>setImportOpen(false)} disabled={!!busy}><X size={19}/></button></div>
        <h2>Open {isBackend ? 'a backend' : 'a frontend'} folder</h2><p>Laravel projects open in Architecture, and Vue projects can run a Vite preview.</p>
        <label htmlFor="folder">Project folder</label>
        <button id="folder" className="quiet" type="button" autoFocus aria-describedby="selected-folder" onClick={browseForFolder} disabled={!!busy}>
          <FolderOpen size={16}/>{busy === 'Choosing folder…' ? busy : 'Choose folder'}
        </button>
        <output id="selected-folder" className="selected-folder" aria-live="polite">{folder || 'No folder selected'}</output>
        {notice?.error && <p className="form-error" role="alert">{notice.text}</p>}
        <button className="primary" disabled={!!busy || !folder}><FolderOpen size={16}/>{busy === 'Opening folder…' ? busy : 'Open Folder'}</button>
      </form>
    </dialog>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
