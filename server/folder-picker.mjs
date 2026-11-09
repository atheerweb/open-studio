import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const windowsPicker = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$dialog = [Windows.Forms.FolderBrowserDialog]::new()
try {
  $dialog.Description = 'Choose a local project folder'
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
}
`;

export async function chooseFrontendFolder() {
  if (process.platform === 'win32') {
    const {stdout} = await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',windowsPicker],{windowsHide:true});
    return stdout || null;
  }
  const mac = process.platform === 'darwin';
  const command = mac ? 'osascript' : 'zenity';
  const args = mac
    ? ['-e','try','-e','POSIX path of (choose folder with prompt "Choose a local project folder")',
      '-e','on error number -128','-e','return ""','-e','end try']
    : ['--file-selection','--directory','--title=Choose a local project folder'];
  try {
    const {stdout} = await run(command,args);
    return stdout.replace(/\n$/,'') || null;
  } catch (failure) {
    if (!mac && failure.code === 1 && !failure.stderr.trim()) return null;
    if (!mac && failure.code === 'ENOENT') throw new Error('Install Zenity to open the folder picker on this system.');
    throw failure;
  }
}
