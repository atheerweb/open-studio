import { app, BrowserWindow, dialog, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startDesktopServer } from './server.mjs';

function runDesktop() {
  const windows = new Map();
  let studio;
  let shuttingDown = false;
  let stopped = false;

  const startup = app.whenReady().then(async () => {
    studio = await startDesktopServer({
      store:process.env.OPEN_STUDIO_DRAFTS_DIR || join(homedir(),'.open-studio','drafts'),
      pickFolder:async workspace => {
        const window = windows.get(workspace);
        if (!window || window.isDestroyed()) return null;
        const result = await dialog.showOpenDialog(window,{title:'Choose a local project folder',properties:['openDirectory']});
        return result.canceled ? null : result.filePaths[0];
      }
    });
    if (!shuttingDown) await openWorkspace('frontend');
  });

  async function openWorkspace(workspace) {
    if (shuttingDown) return;
    const existing = windows.get(workspace);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      if (existing.isVisible()) existing.focus();
      return;
    }

    const window = new BrowserWindow({
      title:workspace === 'backend' ? 'Open Studio — Backend' : 'Open Studio — Frontend',
      width:1440, height:900, minWidth:680, minHeight:580,
      backgroundColor:'#191917', show:false,
      webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true}
    });
    windows.set(workspace,window);
    window.once('closed',() => windows.delete(workspace));
    const {webContents} = window;
    webContents.session.setPermissionRequestHandler((_contents,_permission,respond) => respond(false));
    webContents.session.setPermissionCheckHandler(() => false);
    webContents.on('will-navigate',(event) => event.preventDefault());
    webContents.on('will-redirect',event => {
      if (event.isMainFrame) event.preventDefault();
    });
    webContents.setWindowOpenHandler(({url}) => {
      if (url === studio.url || url === studio.url + '#backend') {
        void openWorkspace(url === studio.url ? 'frontend' : 'backend').catch(console.error);
      } else if (['http:','https:'].includes(new URL(url).protocol)) {
        void shell.openExternal(url).catch(console.error);
      }
      return {action:'deny'};
    });
    try {
      await window.loadURL(workspace === 'backend' ? studio.url + '#backend' : studio.url);
      if (!shuttingDown && !window.isDestroyed()) window.show();
    } catch (failure) {
      if (!window.isDestroyed()) window.destroy();
      throw failure;
    }
  }

  app.on('second-instance',() => {
    if (studio) void openWorkspace(windows.has('frontend') || !windows.has('backend') ? 'frontend' : 'backend').catch(console.error);
  });
  app.on('window-all-closed',() => app.quit());
  app.on('before-quit',event => {
    if (stopped) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void startup.catch(() => {}).then(() => studio?.stop()).catch(console.error).finally(() => {
      stopped = true;
      app.quit();
    });
  });
  void startup.catch(error => {
    if (!shuttingDown) dialog.showErrorBox('Open Studio could not start',error.message);
    app.quit();
  });
}

if (app.requestSingleInstanceLock()) runDesktop();
else app.quit();
