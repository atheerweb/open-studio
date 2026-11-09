import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const patch = {
  type:'object',
  additionalProperties:false,
  required:['find','replace'],
  properties:{find:{type:'string'},replace:{type:'string'}}
};
const schema = {
  type:'object',
  additionalProperties:false,
  required:['message','patch'],
  properties:{message:{type:'string'},patch:{anyOf:[patch,{type:'null'}]}}
};

export function codexArgs(schemaPath, resultPath) {
  return ['--ask-for-approval','never','exec','--sandbox','read-only','--skip-git-repo-check',
    '--ephemeral','--ignore-user-config','--ignore-rules','--output-schema',schemaPath,
    '--output-last-message',resultPath,'-'];
}

function runCodex(args, prompt, cwd) {
  return new Promise((resolve, reject) => {
    const binary = process.env.OPEN_STUDIO_CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
    const child = execFile(binary,args,{cwd,windowsHide:true,timeout:150000,maxBuffer:1048576},error => {
      if (!error) return resolve();
      if (error.code === 'ENOENT') return reject(new Error('Codex CLI was not found. Install it and sign in with codex login.'));
      if (error.killed) return reject(new Error('Codex took too long to respond. Try a smaller edit.'));
      reject(new Error('Codex could not complete the request. Check codex login status and your connection.'));
    });
    child.stdin.on('error',() => {});
    child.stdin.end(prompt);
  });
}

export async function askCodex(system, input, execute = runCodex) {
  const directory = await mkdtemp(join(await realpath(tmpdir()),'open-studio-codex-'));
  try {
    const schemaPath = join(directory,'schema.json');
    const resultPath = join(directory,'result.json');
    await writeFile(schemaPath,JSON.stringify(schema),{flag:'wx'});
    await execute(codexArgs(schemaPath,resultPath),system + '\n\nInput JSON:\n' + JSON.stringify(input),directory);
    try {
      return JSON.parse(await readFile(resultPath,'utf8'));
    } catch {
      throw new Error('Codex returned an unreadable edit response.');
    }
  } finally {
    await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
}
