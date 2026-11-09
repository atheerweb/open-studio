import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { routeFiles, routeBridge, matchPage } from './vue-page.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const rootFile = /^(package(-lock)?\.json|index\.html|vite\.config\.[cm]?[jt]s|[jt]sconfig[^\\/]*\.json|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|\.env(?:\.[a-z0-9_-]+)*)$/i;
const folders = new Set(['src','public','node_modules']);
const windows = process.platform === 'win32';

const copyOptions = {
  recursive:true,
  filter:async path => {
    const name = basename(path);
    if (['.git','.vite','.vite-temp','.cache'].includes(name)) return false;
    const entry = await lstat(path);
    return !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile());
  }
};

async function copyDependencies(from, to) {
  await mkdir(to);
  const packages = await readdir(from);
  let next = 0;
  const workers = Array.from({length:12}, async () => {
    while (next < packages.length) {
      const name = packages[next++];
      await cp(join(from,name), join(to,name), copyOptions);
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export class VueDraft {
  static async open(folder) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.startsWith('\\\\')) throw new Error('Enter an absolute local frontend folder.');
    const source = await realpath(folder);
    if (source === dirname(source)) throw new Error('Select a frontend folder, not a drive root.');
    const packagePath = join(source, 'package.json');
    if (!(await lstat(packagePath)).isFile()) throw new Error('The frontend needs a regular package.json.');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
    if (!(manifest.dependencies?.vue || manifest.devDependencies?.vue) || typeof manifest.scripts?.dev !== 'string' || !/\bvite\b/.test(manifest.scripts.dev)) {
      throw new Error('This build supports Vue frontends with a Vite npm run dev script.');
    }
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'open-studio-vue-'));
    const draft = new VueDraft(directory);
    try {
      for (const entry of await readdir(source, {withFileTypes:true})) {
        if (!(entry.isDirectory() && folders.has(entry.name)) && !(entry.isFile() && rootFile.test(entry.name))) continue;
        const from = join(source, entry.name);
        const to = join(directory, entry.name);
        if (entry.name === 'node_modules') await copyDependencies(from,to);
        else await cp(from,to,copyOptions);
      }
      draft.name = basename(source);
      const entries = await readdir(join(directory, 'src'), {recursive:true, withFileTypes:true});
      for (const file of entries) {
        if (!file.isFile() || !file.name.endsWith('.vue')) continue;
        const path = join(file.parentPath, file.name);
        const key = path.slice(directory.length + 1).split(/[\\/]/).join('/');
        const info = await lstat(path);
        if (info.size <= 524288) draft.baselines.set(key, await readFile(path, 'utf8'));
      }
      for (const entry of entries) {
        if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
        const path = join(entry.parentPath, entry.name);
        const key = path.slice(directory.length + 1).split(/[\\/]/).join('/');
        if (!/(?:^|\/)router(?:\/|\.)/.test(key) || (await lstat(path)).size > 524288) continue;
        draft.routes.push(...routeFiles(key, await readFile(path,'utf8'), draft.baselines));
      }
      return draft;
    } catch (error) {
      await draft.close();
      throw error;
    }
  }

  constructor(directory) {
    this.directory = directory;
    this.baselines = new Map();
    this.routes = [];
    this.logs = '';
    this.state = 'imported';
    this.writePending = false;
  }

  get files() {
    return [...this.baselines.keys()].sort();
  }

  pageFile(route) {
    return matchPage(this.routes, route);
  }

  async installBridge(origin) {
    if (this.bridgeOrigin === origin) return;
    const entry = join(this.directory, 'index.html');
    const html = await readFile(entry, 'utf8');
    if (!/<\/head\s*>/i.test(html)) throw new Error('The preview index.html needs a closing head tag.');
    const script = join(this.directory, 'public', '__open_studio_route__.js');
    await mkdir(dirname(script), {recursive:true});
    await writeFile(script, routeBridge(origin), {flag:'wx'});
    try {
      await writeFile(entry, html.replace(/<\/head\s*>/i,
        '<script defer src="/__open_studio_route__.js"></script>\n$&'));
      this.bridgeOrigin = origin;
    } catch (error) {
      await rm(script, {force:true});
      throw error;
    }
  }

  async pathFor(file) {
    if (!this.baselines.has(file)) throw new Error('Unknown Vue source file.');
    const candidate = join(this.directory, ...file.split('/'));
    const actual = await realpath(candidate);
    if (resolve(actual).toLowerCase() !== resolve(candidate).toLowerCase() || !(await lstat(candidate)).isFile()) {
      throw new Error('The draft file is no longer a regular source file.');
    }
    return candidate;
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
    if (this.child || this.state === 'starting') throw new Error('A draft preview is already running or starting.');
    this.state = 'starting';
    try {
      const vite = join(this.directory, 'node_modules', 'vite', 'bin', 'vite.js');
      if (!(await lstat(vite).catch(() => null))?.isFile()) throw new Error('Install the frontend dependencies before importing it.');
      await new Promise((resolve, reject) => {
        const check = createServer();
        check.once('error', () => reject(new Error('Preview port ' + port + ' is unavailable. Choose a different port.')));
        check.listen(port, 'localhost', () => check.close(resolve));
      });
      this.logs = '';
      this.url = 'http://localhost:' + port;
      const args = ['run','dev','--','--host','localhost','--port',String(port),'--strictPort'];
      const child = spawn(windows ? 'npm.cmd ' + args.join(' ') : 'npm', windows ? [] : args, {
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
    if (dirname(this.directory) !== await realpath(tmpdir()) || !basename(this.directory).startsWith('open-studio-vue-')) {
      throw new Error('Unexpected draft cleanup path.');
    }
    await rm(this.directory, {recursive:true, force:true, maxRetries:4, retryDelay:150});
  }
}
