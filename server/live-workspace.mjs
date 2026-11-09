import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fingerprint } from './draft-publish.mjs';
import { VueDraft } from './vue-draft.mjs';
import { routeBridge } from './vue-page.mjs';

export class LiveWorkspace extends VueDraft {
  live = true;

  static async open(folder,store) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.startsWith('\\\\')) {
      throw new Error('Enter an absolute local project folder.');
    }
    const source = await realpath(folder);
    if (source === dirname(source) || !(await lstat(source)).isDirectory()) {
      throw new Error('Select a local project folder.');
    }
    const workspace = new LiveWorkspace(source,source);
    workspace.name = basename(source);
    const manifest = await readFile(join(source,'package.json'),'utf8').then(JSON.parse).catch(() => null);
    workspace.canPreview = Boolean((manifest?.dependencies?.vue || manifest?.devDependencies?.vue) &&
      typeof manifest.scripts?.dev === 'string' && /\bvite\b/.test(manifest.scripts.dev));
    if (store) {
      const project = join(store,'live-' + fingerprint(process.platform === 'win32' ? source.toLowerCase() : source));
      await mkdir(project,{recursive:true});
      workspace.metadata = join(project,'state.json');
      const saved = await readFile(workspace.metadata,'utf8').then(JSON.parse).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (saved?.sessions?.length) {
        workspace.sessions = saved.sessions;
        workspace.activeSession = workspace.sessions.find(session => session.id === saved.activeSessionId) || workspace.sessions[0];
        workspace.pendingEdit = saved.pendingEdit;
        workspace.lastAgentEdits = saved.lastAgentEdits;
      }
    }
    await workspace.refreshFiles();
    return workspace;
  }

  async installBridge(origin) {
    this.studioOrigin = origin;
  }

  async prepareDependencies() {
    if (!this.canPreview) throw new Error('Preview requires a Vue project with a Vite npm run dev script.');
    let vite;
    try {
      vite = pathToFileURL(createRequire(join(this.directory,'package.json')).resolve('vite')).href;
    } catch {
      throw new Error('Install the project dependencies before starting the preview.');
    }
    this.previewDirectory ??= await mkdtemp(join(await realpath(tmpdir()),'open-studio-preview-'));
    const config = join(this.previewDirectory,'vite.config.mjs');
    await writeFile(config,`
const viteUrl = ${JSON.stringify(vite)};
export default async function (env) {
  const {loadConfigFromFile,mergeConfig} = await import(viteUrl);
  const original = await loadConfigFromFile(env,undefined,process.cwd());
  return mergeConfig(original?.config || {}, {plugins:[{
    name:'open-studio-preview',
    transformIndexHtml() {
      return [{tag:'script',children:${JSON.stringify(routeBridge(this.studioOrigin))},injectTo:'head'}];
    }
  }]});
}
`);
    return ['--config',config];
  }

  async stop() {
    await super.stop();
    if (this.previewDirectory) {
      await rm(this.previewDirectory,{recursive:true,force:true,maxRetries:4,retryDelay:150});
      this.previewDirectory = undefined;
    }
  }

  async close() {
    await this.stop();
    await this.saveState();
  }
}
