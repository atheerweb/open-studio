import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,unlink,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {analyzeArchitecture} from './architecture-graph.mjs';
import {runArchitectureSkills} from './codex.mjs';

const exec = promisify(execFile);
const version = 2;
const maxSource = 384 * 1024;
const maxArtifact = 32 * 1024 * 1024;
const graphDirs = ['.understand-anything','.ua'];
const ignoredSegment = /^(?:\..+|vendor|node_modules|dist|build|storage|coverage|cache|logs?|secrets?|credentials?)$/i;
const extensions = /\.(?:php|[cm]?[jt]sx?|vue|go|py|rb|java|kt|cs|rs|sql|ya?ml|json|toml|md)$/i;
const sensitiveName = /(?:^|[._-])(?:env|secret|credentials?|private[-_]?key|id_rsa|id_ed25519|service[-_]?account|token)(?:[._-]|$)/i;
const key = value => createHash('sha256').update(value).digest('hex');
const identity = value => process.platform === 'win32' ? value.replaceAll('\\','/').toLowerCase() : value;
const git = (cwd,args) => exec('git',args,{cwd,windowsHide:true,timeout:8000,maxBuffer:16 * 1024 * 1024})
  .then(result=>result.stdout).catch(()=>null);
const sourcePath = path => typeof path === 'string' && !isAbsolute(path) && !/[:\\\0]/.test(path) &&
  path.split('/').every(part=>part && !ignoredSegment.test(part)) && extensions.test(path) &&
  !sensitiveName.test(path.split('/').at(-1));

async function readInside(folder,path,limit) {
  const full = resolve(folder,path);
  const local = relative(folder,full);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) return null;
  try {
    const info = await lstat(full);
    if (!info.isFile() || info.size > limit || identity(await realpath(full)) !== identity(full)) return null;
    const data = await readFile(full);
    return data.length <= limit ? data.toString('utf8') : null;
  } catch (error) {
    if (['ENOENT','ENOTDIR','ELOOP','EACCES','EPERM'].includes(error.code)) return null;
    throw error;
  }
}

async function fallbackPaths(folder,prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(folder,prefix),{withFileTypes:true})) {
    if (ignoredSegment.test(entry.name)) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) paths.push(...await fallbackPaths(folder,path + '/'));
    else if (entry.isFile() && sourcePath(path)) paths.push(path);
  }
  return paths;
}

async function collectSnapshot(folder,artifactsDir) {
  const listed = await git(folder,['ls-files','-z','--cached','--others','--exclude-standard','--','.']);
  const paths = [...new Set(listed === null ? await fallbackPaths(folder) : listed.split('\0').filter(sourcePath))].sort();
  const files = new Map();
  const hash = createHash('sha256');
  let size = 0;
  for (let index = 0; index < paths.length; index += 24) {
    const chunk = paths.slice(index,index + 24);
    const data = await Promise.all(chunk.map(path=>readInside(folder,path,maxSource)));
    for (const [i,text] of data.entries()) {
      if (text === null) continue;
      size += Buffer.byteLength(text);
      if (size > 40 * 1024 * 1024) throw new Error('This folder exceeds the architecture source limit of 40 MiB.');
      files.set(chunk[i],text);
      hash.update(JSON.stringify([chunk[i],text]));
    }
  }
  const artifacts = await readArtifacts(folder,artifactsDir,hash);
  return {files,artifacts,gitFiltered:listed !== null,fingerprint:hash.digest('hex')};
}

async function readArtifacts(folder,dir,hash) {
  const artifacts = {};
  if (!dir) return artifacts;
  for (const [kind,name] of [['knowledge','knowledge-graph.json'],['domain','domain-graph.json']]) {
    const text = await readInside(folder,dir + '/' + name,maxArtifact);
    if (!text) continue;
    try {
      const graph = JSON.parse(text.replace(/^\uFEFF/,''));
      if (Array.isArray(graph?.nodes) && Array.isArray(graph?.edges)) {
        artifacts[kind] = graph;
        hash?.update(JSON.stringify([kind,text]));
      }
    } catch {
      // An external generator can be replacing its JSON output.
    }
  }
  return artifacts;
}

async function findArtifacts(folder) {
  for (const dir of graphDirs) {
    for (const name of ['knowledge-graph.json','domain-graph.json']) {
      if (await lstat(join(folder,dir,name)).then(info=>info.isFile()).catch(()=>false)) return dir;
    }
  }
}

async function writeAtomically(path,data) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp,data,{flag:'wx'});
  try {
    await rename(temp,path);
  } finally {
    await unlink(temp).catch(()=>{});
  }
}

const psQuote = value => "'" + value.replaceAll("'","''") + "'";
const graphItems = graph => [graph.modules,graph.system,...graph.lifecycles].flatMap(view=>[
  ...view.nodes,...view.edges,...view.nodes.flatMap(node=>node.members || [])
]);

function evidenceHashes(graph,files) {
  const paths = new Set(graphItems(graph).map(item=>item.source?.path));
  return Object.fromEntries([...paths].filter(path=>files.has(path)).map(path=>[path,key(files.get(path))]));
}

async function enrichSnapshot(files,runSkills,signal) {
  const tempRoot = await realpath(tmpdir());
  const folder = await mkdtemp(join(tempRoot,'open-studio-architecture-'));
  try {
    for (const [path,text] of files) {
      signal.throwIfAborted();
      if (/(^|\/)(?:agents|claude|gemini)\.md$/i.test(path)) continue;
      const target = join(folder,path);
      await mkdir(dirname(target),{recursive:true});
      await writeFile(target,text);
    }
    await runSkills(folder,signal);
    const output = await readArtifacts(folder,await findArtifacts(folder));
    if (!output.knowledge?.nodes.length || !output.domain?.nodes.length) {
      throw new Error('Understand Anything did not produce both graphs. The local diagrams are available.');
    }
    return output;
  } finally {
    if (dirname(folder) === tempRoot) await rm(folder,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
}

export async function openArchitecture(folder,store,{runSkills = runArchitectureSkills} = {}) {
  const manifest = await readInside(folder,'composer.json',maxSource);
  const isLaravel = Boolean(manifest?.includes('"laravel/framework"'));
  if (!isLaravel && !await findArtifacts(folder)) return null;

  const cacheRoot = store && join(store,'architecture');
  const cache = cacheRoot && join(cacheRoot,key(identity(folder)) + '.json');
  const setting = cache && cache + '.ai';
  const gitRoot = (await git(folder,['rev-parse','--show-toplevel']))?.trim();
  const events = cacheRoot && gitRoot && join(cacheRoot,'terminal-events');
  const marker = events && join(events,key(identity(gitRoot)) + '.json');
  const saved = cache && await readFile(cache,'utf8').then(JSON.parse).catch(()=>null);
  let record = saved?.version === version ? saved : null;
  let current;
  let lastSignal;
  let stopped = false;
  let pending = false;
  let checking = false;
  let timer;
  let message = '';
  let warning = '';
  let enabled = setting && await readFile(setting,'utf8').then(value=>value === 'enabled').catch(()=>false);
  let attempted;
  let enrichment;

  async function publish(next) {
    if (cache) {
      await mkdir(cacheRoot,{recursive:true});
      await writeAtomically(cache,JSON.stringify(next));
    }
    record = next;
    message = '';
  }

  async function generate() {
    const artifactsDir = await findArtifacts(folder);
    const snapshot = await collectSnapshot(folder,artifactsDir);
    const imported = Object.values(snapshot.artifacts);
    const [head,changed,untracked] = imported.length ? await Promise.all([
      git(folder,['rev-parse','HEAD']),git(folder,['diff','--name-only','-z','HEAD','--','.']),
      git(folder,['ls-files','--others','--exclude-standard','-z','--','.'])
    ]) : [];
    const importedStale = imported.length > 0 && (!head || changed === null || untracked === null ||
      imported.some(artifact=>artifact.project?.gitCommitHash !== head.trim()) ||
      (changed + untracked).split('\0').some(sourcePath));
    const same = snapshot.fingerprint === record?.fingerprint;
    const useAI = enabled && (importedStale || !snapshot.artifacts.knowledge || !snapshot.artifacts.domain) &&
      attempted !== snapshot.fingerprint && !(same && record.enriched);
    if (same && !useAI && (record.enriched || record.importedStale === importedStale)) {
      message = '';
      return;
    }
    if (!isLaravel && !Object.keys(snapshot.artifacts).length) throw new Error('No valid Understand Anything graph is available.');
    const stillCurrent = async () => {
      const latest = await collectSnapshot(folder,await findArtifacts(folder));
      if (stopped) return false;
      if (latest.fingerprint === snapshot.fingerprint) return true;
      pending = true;
      return false;
    };
    if (!same || (!record.enriched && record.importedStale !== importedStale)) {
      const graph = analyzeArchitecture(snapshot.files,snapshot.artifacts);
      if (!await stillCurrent()) return;
      warning = '';
      await publish({version,fingerprint:snapshot.fingerprint,generatedAt:new Date().toISOString(),graph,importedStale,
        evidence:evidenceHashes(graph,snapshot.files)});
    }
    if (!useAI || stopped || !enabled) return;
    if (!snapshot.gitFiltered) {
      warning = 'AI analysis requires Git to verify which files are eligible. The local diagrams are available.';
      return;
    }
    attempted = snapshot.fingerprint;
    enrichment = new AbortController();
    try {
      const artifacts = await enrichSnapshot(snapshot.files,runSkills,enrichment.signal);
      if (!enabled || !await stillCurrent()) return;
      const graph = analyzeArchitecture(snapshot.files,artifacts);
      await publish({...record,graph,enriched:true,importedStale:false,generatedAt:new Date().toISOString(),
        evidence:evidenceHashes(graph,snapshot.files)});
      warning = '';
    } catch (error) {
      if (!enrichment.signal.aborted) warning = error.message;
    } finally {
      enrichment = undefined;
    }
  }

  function refresh() {
    if (stopped) return;
    pending = true;
    if (current) return;
    current = (async () => {
      try {
        while (!stopped && pending) {
          pending = false;
          await generate();
        }
      } catch (error) {
        message = error.message || 'Architecture analysis could not finish.';
      } finally {
        current = null;
      }
    })();
  }

  async function inspectGit() {
    if (stopped || checking || !gitRoot) return;
    checking = true;
    try {
      const [head,upstream,event] = await Promise.all([
        git(folder,['rev-parse','--verify','HEAD']),
        git(folder,['rev-parse','--verify','@{upstream}']),
        marker ? readFile(marker,'utf8').catch(()=>null) : null
      ]);
      if (!head) return;
      const signal = JSON.stringify([head,upstream,event]);
      if (lastSignal !== undefined && signal !== lastSignal) refresh();
      lastSignal = signal;
    } finally {
      checking = false;
    }
  }
  refresh();
  if (gitRoot) {
    void inspectGit();
    timer = setInterval(()=>void inspectGit(),3000);
    timer.unref();
  }
  return {
    refresh({retry = false} = {}) {
      if (retry) attempted = undefined;
      refresh();
    },
    async enableAI(value) {
      if (!setting || !isLaravel || !gitRoot) return;
      await mkdir(cacheRoot,{recursive:true});
      await writeAtomically(setting,value ? 'enabled' : 'disabled');
      enabled = value;
      warning = '';
      attempted = undefined;
      if (!enabled) enrichment?.abort();
      refresh();
    },
    get current() {return current;},
    async close() {
      stopped = true;
      clearInterval(timer);
      enrichment?.abort();
      await current;
    },
    status(includeGraph = true) {
      return {state:current ? (record ? 'updating' : 'generating') : message ? 'failed' : 'ready',
        message,warning,terminal:!!events,canEnableAI:!!setting && isLaravel && !!gitRoot,aiEnabled:!!enabled,
        generatedAt:record?.generatedAt,importedStale:record?.importedStale,
        ...(includeGraph && {graph:record?.graph})};
    },
    async read(source) {
      const selected = record;
      if (!selected || !graphItems(selected.graph).some(item=>
        item.source && item.source.path === source?.path && item.source.line === source?.line)) return null;
      const text = sourcePath(source?.path) && await readInside(folder,source.path,maxSource);
      if (typeof text !== 'string' || key(text) !== selected.evidence[source.path]) return null;
      const lines = text.split(/\r?\n/);
      const line = Math.min(lines.length,Number.isSafeInteger(source.line) ? Math.max(1,source.line) : 1);
      const start = Math.max(1,line - 8);
      return {path:source.path,line,start,text:lines.slice(start - 1,line + 8).join('\n')};
    },
    async terminalCommand() {
      if (!events) return null;
      const script = join(cacheRoot,'architecture-terminal.ps1');
      await mkdir(events,{recursive:true});
      await writeAtomically(script,await readFile(new URL('./architecture-terminal.ps1',import.meta.url)));
      return '. ' + psQuote(script) + ' ' + psQuote(events);
    }
  };
}
