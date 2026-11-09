import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { routeFiles, routeBridge, matchPage } from './vue-page.mjs';
import { atomicWrite, bridgeFile, bridgeTag, fingerprint, projectFolders as folders, recordBaseline,
  rootFile, reviewDraft, publishDraft, resolveDraftConflict, safeFile } from './draft-publish.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const windows = process.platform === 'win32';
// HTTP ports in the Fetch blocklist within the supported preview range.
// https://fetch.spec.whatwg.org/#port-blocking
const blockedPreviewPorts = new Set([
  1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,
  6665,6666,6667,6668,6669,6679,6697,10080
]);

const copyOptions = {
  recursive:true,
  filter:async path => {
    const name = basename(path);
    if (['.git','.vite','.vite-temp','.cache'].includes(name)) return false;
    const entry = await lstat(path);
    return !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile());
  }
};

async function copyDependencies(from, to, progress) {
  await mkdir(to);
  const packages = await readdir(from);
  let next = 0;
  let copied = 0;
  progress(copied,packages.length);
  const workers = Array.from({length:12}, async () => {
    while (next < packages.length) {
      const name = packages[next++];
      await cp(join(from,name), join(to,name), copyOptions);
      progress(++copied,packages.length);
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export class VueDraft {
  static async open(folder, store) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.startsWith('\\\\')) throw new Error('Enter an absolute local frontend folder.');
    const source = await realpath(folder);
    if (source === dirname(source)) throw new Error('Select a frontend folder, not a drive root.');
    const packagePath = join(source, 'package.json');
    if (!(await lstat(packagePath)).isFile()) throw new Error('The frontend needs a regular package.json.');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    if (!(manifest.dependencies?.vue || manifest.devDependencies?.vue) || typeof manifest.scripts?.dev !== 'string' || !/\bvite\b/.test(manifest.scripts.dev)) {
      throw new Error('This build supports Vue frontends with a Vite npm run dev script.');
    }
    if (store) await mkdir(store,{recursive:true});
    const project = store && join(await realpath(store),fingerprint(windows ? source.toLowerCase() : source));
    const metadata = project && join(project,'state.json');
    const saved = metadata && await readFile(metadata,'utf8').then(JSON.parse).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (project) await mkdir(project,{recursive:true});
    const directory = saved?.directory || await mkdtemp(join(project || await realpath(tmpdir()), 'open-studio-vue-'));
    const draft = new VueDraft(directory,source);
    if (saved && (dirname(directory) !== project || !basename(directory).startsWith('open-studio-vue-'))) {
      throw new Error('Invalid saved draft directory.');
    }
    try {
      for (const entry of saved ? [] : await readdir(source, {withFileTypes:true})) {
        if (!(entry.isDirectory() && folders.has(entry.name)) && !(entry.isFile() && rootFile.test(entry.name))) continue;
        const from = join(source, entry.name);
        const to = join(directory, entry.name);
        await cp(from,to,copyOptions);
      }
      draft.name = basename(source);
      draft.projectBaseline = saved?.baseline || await recordBaseline(directory);
      draft.bridgeOrigin = saved?.bridgeOrigin;
      if (saved?.sessions?.length) {
        draft.sessions = saved.sessions;
        draft.activeSession = draft.sessions.find(session => session.id === saved.activeSessionId) || draft.sessions[0];
      } else if (saved) {
        Object.assign(draft.activeSession,{threadId:saved.threadId,messages:saved.messages || [],lastDecision:saved.lastDecision});
      }
      draft.pendingEdit = saved?.pendingEdit;
      draft.lastAgentEdits = saved?.lastAgentEdits;
      draft.dependenciesReady = Boolean(saved && await lstat(join(directory,'node_modules','vite','bin','vite.js')).catch(() => null));
      await draft.refreshFiles();
      if (!saved && metadata) await draft.saveState(metadata);
      draft.metadata = metadata;
      return draft;
    } catch (error) {
      if (!saved) await rm(directory,{recursive:true,force:true});
      throw error;
    }
  }

  async refreshFiles() {
    const {directory} = this;
    const entries = await readdir(join(directory, 'src'), {recursive:true, withFileTypes:true}).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const previous = this.baselines;
    this.baselines = new Map();
    this.routes = [];
    for (const file of entries) {
      if (!file.isFile() || !file.name.endsWith('.vue')) continue;
      const path = join(file.parentPath, file.name);
      const key = path.slice(directory.length + 1).split(/[\\/]/).join('/');
      const info = await lstat(path);
      if (info.size > 524288) continue;
      const sourceText = await readFile(await safeFile(this.source,key),'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      this.baselines.set(key, previous.get(key) ?? sourceText);
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      const key = path.slice(directory.length + 1).split(/[\\/]/).join('/');
      if (!/(?:^|\/)router(?:\/|\.)/.test(key) || (await lstat(path)).size > 524288) continue;
      this.routes.push(...routeFiles(key, await readFile(path,'utf8'), this.baselines));
    }
    if (!this.routes.length && this.baselines.has('src/App.vue')) {
      this.routes.push({route:'/',file:'src/App.vue'});
    }
  }

  async saveState(metadata = this.metadata, baseline = this.projectBaseline) {
    if (!metadata) return;
    await atomicWrite(metadata,JSON.stringify({directory:this.directory,baseline,
      bridgeOrigin:this.bridgeOrigin,sessions:this.sessions,activeSessionId:this.activeSession.id,
      pendingEdit:this.pendingEdit,lastAgentEdits:this.lastAgentEdits}));
  }

  async updateBaseline(baseline) {
    await this.saveState(this.metadata,baseline);
    this.projectBaseline = baseline;
  }

  review() { return reviewDraft(this); }
  async publish(token) {
    await publishDraft(this,token);
    this.baselines.clear();
    await this.refreshFiles();
  }
  resolveConflict(file,expectedHash,merged,keepOriginal) { return resolveDraftConflict(this,file,expectedHash,merged,keepOriginal); }

  constructor(directory,source) {
    this.directory = directory;
    this.source = source;
    this.baselines = new Map();
    this.routes = [];
    this.logs = '';
    this.state = 'imported';
    this.writePending = false;
    this.activeSession = {id:randomUUID(),messages:[]};
    this.sessions = [this.activeSession];
  }

  get messages() { return this.activeSession.messages; }
  get threadId() { return this.activeSession.threadId; }
  set threadId(value) { this.activeSession.threadId = value; }
  get lastDecision() { return this.activeSession.lastDecision; }
  set lastDecision(value) { this.activeSession.lastDecision = value; }

  async selectSession(session) {
    const previous = this.activeSession;
    const sessions = this.sessions;
    if (!session) {
      session = {id:randomUUID(),messages:[]};
      this.sessions = [...sessions,session];
    }
    this.activeSession = session;
    try {
      await this.saveState();
    } catch (error) {
      this.activeSession = previous;
      this.sessions = sessions;
      throw error;
    }
  }

  get files() {
    return [...this.baselines.keys()].sort();
  }

  pageFile(route) {
    return matchPage(this.routes, route);
  }

  async installBridge(origin) {
    const entry = join(this.directory, 'index.html');
    const html = await readFile(entry, 'utf8');
    if (!/<\/head\s*>/i.test(html)) throw new Error('The preview index.html needs a closing head tag.');
    const script = await safeFile(this.directory,bridgeFile);
    const bridge = routeBridge(origin);
    await mkdir(dirname(script), {recursive:true});
    if (this.bridgeOrigin && html.includes(bridgeTag)) {
      const current = await readFile(script,'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (current === null) {
        await writeFile(script,bridge,{flag:'wx'});
      } else if (current !== bridge) {
        try {
          await atomicWrite(script,bridge);
        } catch (error) {
          if (!windows || error.syscall !== 'rename' ||
              !['EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
          // This generated file can be rewritten when Windows denies replacement.
          const handle = await open(await safeFile(this.directory,bridgeFile),'r+');
          try {
            await handle.writeFile(bridge);
            await handle.truncate(Buffer.byteLength(bridge));
          } finally {
            await handle.close();
          }
        }
      }
      if (this.bridgeOrigin === origin) return;
      const previousOrigin = this.bridgeOrigin;
      this.bridgeOrigin = origin;
      try {
        await this.saveState();
      } catch (error) {
        this.bridgeOrigin = previousOrigin;
        throw error;
      }
      return;
    }
    await writeFile(script, bridge, {flag:'wx'});
    try {
      await writeFile(entry, html.replace(/<\/head\s*>/i,
        bridgeTag + '$&'));
      this.bridgeOrigin = origin;
      await this.saveState();
    } catch (error) {
      await rm(script, {force:true});
      throw error;
    }
  }

  async pathFor(file) {
    if (!this.baselines.has(file)) throw new Error('Unknown Vue source file.');
    return safeFile(this.directory,file);
  }

  async read(file) {
    const text = await readFile(await this.pathFor(file), 'utf8');
    return {file, text, original:this.baselines.get(file), hash:hash(text)};
  }

  async write(file, expectedHash, text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 524288) throw new Error('Invalid Vue source text.');
    if (this.writePending) throw new Error('Another draft edit is in progress.');
    this.writePending = true;
    try {
      const current = await this.read(file);
      if (current.hash !== expectedHash) throw new Error('The draft file changed. Reload it before saving.');
      const path = await this.pathFor(file);
      if (current.text !== text) {
        const temporary = path + '.open-studio-' + crypto.randomUUID();
        await writeFile(temporary, text, {flag:'wx'});
        try {
          try {
            await rename(temporary, path);
          } catch (error) {
            if (!windows || !['EPERM','EACCES','EBUSY'].includes(error.code)) throw error;
            // Windows watchers may prevent replacement while allowing writes to the draft.
            const latest = await this.read(file);
            if (latest.hash !== expectedHash) throw new Error('The draft file changed. Reload it before saving.');
            const handle = await open(await this.pathFor(file), 'r+');
            try {
              await handle.writeFile(text);
              await handle.truncate(Buffer.byteLength(text));
            } finally {
              await handle.close();
            }
          }
        } finally {
          await rm(temporary, {force:true});
        }
      }
      return this.read(file);
    } finally {
      this.writePending = false;
    }
  }

  async start(port = 5173) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a preview port between 1024 and 65535.');
    if (blockedPreviewPorts.has(port)) throw new Error('Preview port ' + port + ' is blocked for HTTP. Choose another port, such as 5174.');
    if (this.child || this.state === 'starting') throw new Error('A draft preview is already running or starting.');
    this.state = 'starting';
    try {
      await new Promise((resolve, reject) => {
        const check = createServer();
        check.once('error', () => reject(new Error('Preview port ' + port + ' is unavailable. Choose a different port.')));
        check.listen(port, 'localhost', () => check.close(resolve));
      });
      const previewArgs = await this.prepareDependencies() || [];
      this.logs = '';
      this.url = 'http://localhost:' + port;
      const args = ['run','dev','--','--host','localhost','--port',String(port),'--strictPort',...previewArgs];
      const child = spawn(windows ? 'npm.cmd ' + args.map(arg => '"' + arg + '"').join(' ') : 'npm', windows ? [] : args, {
        cwd:this.directory, shell:windows, windowsHide:true, detached:!windows,
        stdio:['ignore','pipe','pipe']
      });
      this.child = child;
      const record = chunk => { this.logs = (this.logs + chunk).slice(-16000); };
      child.stdout.on('data', record);
      child.stderr.on('data', record);
      child.once('error', error => { record(error.message); this.state = 'failed'; this.child = undefined; });
      child.once('exit', code => {
        if (this.child !== child) return;
        this.child = undefined;
        this.state = code === 0 ? 'stopped' : 'failed';
      });
      for (let attempt = 0; attempt < 60 && this.child === child; attempt++) {
        try {
          const page = await fetch(this.url, {signal:AbortSignal.timeout(600)});
          await page.body?.cancel();
          if (page.ok && this.child === child) {
            this.state = 'ready';
            return;
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      throw new Error('Vite did not start. Check the preview log.');
    } catch (error) {
      await this.stop();
      this.state = 'failed';
      throw error;
    }
  }

  async prepareDependencies() {
    const from = join(this.source,'node_modules');
    const to = join(this.directory,'node_modules');
    const incompleteCopy = join(this.directory,'.open-studio-dependencies-incomplete');
    if (windows && await lstat(incompleteCopy).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })) {
      this.dependenciesReady = false;
      await rm(to,{recursive:true,force:true,maxRetries:4,retryDelay:150});
      await unlink(incompleteCopy);
    }
    // Some Vite versions strip drive letters when serving assets through /@fs.
    const crossDrive = windows && parse(from).root.toLowerCase() !== parse(to).root.toLowerCase();
    if (this.dependenciesReady && !crossDrive) return;
    const existing = crossDrive ? await lstat(to).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }) : null;
    const replaceLink = existing?.isSymbolicLink();
    if (this.dependenciesReady && existing && !replaceLink) return;
    this.dependenciesReady = false;
    const vitePath = ['vite','bin','vite.js'];
    const sourceModules = await lstat(from).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!sourceModules?.isDirectory() || !(await lstat(join(from,...vitePath)).catch(() => null))?.isFile()) {
      throw new Error('Install the frontend dependencies in the original folder before starting the preview.');
    }
    if (!crossDrive) {
      try {
        await symlink(from,to,windows ? 'junction' : 'dir');
        this.dependenciesReady = true;
        return;
      } catch (error) {
        if (!['EACCES','EPERM','ENOSYS','ENOTSUP','EXDEV','EINVAL'].includes(error.code)) throw error;
        this.dependencyFallback = 'Could not link installed dependencies. Studio is using a private copy.';
      }
    } else {
      this.dependencyFallback = 'Studio uses a private copy of dependencies for previews across Windows drives.';
    }
    // Windows can deny directory renames even when copying individual files succeeds.
    // Keep a marker until the direct copy is complete so a retry can discard partial files.
    const staging = windows ? null : await mkdtemp(join(this.directory,'.open-studio-dependencies-'));
    try {
      if (windows) {
        if (replaceLink) await unlink(to);
        const destination = await lstat(to).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (destination) throw new Error('The draft already has a node_modules folder that Studio cannot replace.');
        await writeFile(incompleteCopy,'',{flag:'wx'});
      }
      const copy = staging ? join(staging,'node_modules') : to;
      await copyDependencies(from,copy,(copied,total) => { this.dependencyProgress = {copied,total}; });
      if (!(await lstat(join(copy,...vitePath)).catch(() => null))?.isFile()) {
        throw new Error('Vite could not be copied. This version needs an npm installation with local dependencies.');
      }
      if (staging) await rename(copy,to);
      else await unlink(incompleteCopy);
      this.dependenciesReady = true;
    } finally {
      this.dependencyProgress = null;
      if (staging) await rm(staging,{recursive:true,force:true,maxRetries:4,retryDelay:150});
    }
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    if (child?.pid) {
      if (windows) {
        await new Promise(resolve => {
          const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'});
          kill.once('close', resolve);
          kill.once('error', resolve);
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    this.state = 'stopped';
  }

  async close() {
    await this.stop();
    if (this.metadata) {
      await this.saveState();
      return;
    }
    if (dirname(this.directory) !== await realpath(tmpdir()) || !basename(this.directory).startsWith('open-studio-vue-')) {
      throw new Error('Unexpected draft cleanup path.');
    }
    await rm(this.directory, {recursive:true, force:true, maxRetries:4, retryDelay:150});
  }
}
