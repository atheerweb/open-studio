import { app, BrowserWindow, dialog, shell } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startDesktopServer } from './server.mjs';

function runDesktop() {
  let window;
  let studio;
  let shuttingDown = false;
  let stopped = false;

  const startup = app.whenReady().then(async () => {
    studio = await startDesktopServer({
      store:process.env.OPEN_STUDIO_DRAFTS_DIR || join(homedir(),'.open-studio','drafts'),
      pickFolder:async () => {
        if (!window || window.isDestroyed()) return null;
        const result = await dialog.showOpenDialog(window,{title:'Choose a local project folder',properties:['openDirectory']});
        return result.canceled ? null : result.filePaths[0];
      }
    });
    if (shuttingDown) return;

    window = new BrowserWindow({
      title:'Open Studio', width:1440, height:900, minWidth:860, minHeight:580,
      backgroundColor:'#191917', show:false,
      webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true}
    });
    const {webContents} = window;
    webContents.session.setPermissionRequestHandler((_contents,_permission,respond) => respond(false));
    webContents.session.setPermissionCheckHandler(() => false);
    webContents.on('will-navigate',(event) => event.preventDefault());
    webContents.on('will-redirect',event => {
      if (event.isMainFrame) event.preventDefault();
    });
    webContents.setWindowOpenHandler(({url}) => {
      if (['http:','https:'].includes(new URL(url).protocol)) void shell.openExternal(url).catch(console.error);
      return {action:'deny'};
    });
    await window.loadURL(studio.url);
    if (!shuttingDown) window.show();
  });

  app.on('second-instance',() => {
    if (!window || window.isDestroyed() || shuttingDown) return;
    if (window.isMinimized()) window.restore();
    window.focus();
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
