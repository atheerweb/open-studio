import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const patch = {
  type:'object',
  additionalProperties:false,
  required:['find','replace'],
  properties:{find:{type:'string'},replace:{type:'string'}}
};

const codexBinary = () => process.env.OPEN_STUDIO_CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
export const reasoningEfforts = ['none','minimal','low','medium','high','xhigh','max','ultra'];
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
    const binary = codexBinary();
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

const sessionSchema = {
  type:'object',additionalProperties:false,required:['message','edits','question'],
  properties:{
    message:{type:'string'},
    question:{anyOf:[{type:'null'},{
      type:'object',additionalProperties:false,required:['text','options'],
      properties:{text:{type:'string'},options:{type:'array',items:{type:'string'}}}
    }]},
    edits:{type:'array',items:{
      type:'object',additionalProperties:false,required:['file','find','replace'],
      properties:{file:{type:'string'},find:{type:['string','null']},replace:{type:['string','null']}}
    }}
  }
};

export async function runCodexSession({cwd,threadId,model,reasoningEffort,prompt,emit}) {
  const directory = await mkdtemp(join(await realpath(tmpdir()),'open-studio-codex-'));
  const schemaPath = join(directory,'schema.json');
  const resultPath = join(directory,'result.json');
  try {
    await writeFile(schemaPath,JSON.stringify(sessionSchema));
    const args = ['--ask-for-approval','never','-c','sandbox_mode="read-only"'];
    if (reasoningEffort) args.push('-c','model_reasoning_effort=' + JSON.stringify(reasoningEffort));
    args.push('exec');
    if (threadId) args.push('resume');
    args.push('--skip-git-repo-check','--json','--output-schema',schemaPath,'--output-last-message',resultPath);
    if (model) args.push('--model',model);
    if (threadId) args.push(threadId);
    args.push('-');
    await new Promise((resolve,reject) => {
      const child = execFile(codexBinary(),args,{cwd,windowsHide:true,timeout:600000,maxBuffer:16777216},error => {
        if (!error) return resolve();
        if (error.code === 'ENOENT') return reject(new Error('Install the Codex CLI and sign in with codex login.'));
        if (error.killed) return reject(new Error('The Codex session timed out.'));
        reject(new Error('Codex could not finish this turn. Check codex login and your connection.'));
      });
      const lines = createInterface({input:child.stdout});
      lines.on('line',line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        emit(event);
      });
      child.stdin.on('error',() => {});
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(resultPath,'utf8'));
  } finally {
    await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
}

function collectCodexList(cwd, method, params, collect, unavailableMessage) {
  return new Promise((resolve,reject) => {
    const child = spawn(codexBinary(),['app-server','--stdio'],{cwd,windowsHide:true,stdio:['pipe','pipe','ignore']});
    const lines = createInterface({input:child.stdout});
    const items = [];
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.destroy();
      child.kill();
      if (error) reject(error);
      else resolve(items);
    };
    const unavailable = () => new Error(unavailableMessage);
    const timer = setTimeout(() => finish(unavailable()),12000);
    const send = message => child.stdin.write(JSON.stringify(message)+'\n');
    child.on('error',() => finish(unavailable()));
    child.on('exit',() => finish(unavailable()));
    child.stdin.on('error',() => finish(unavailable()));
    lines.on('line',line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1 && message.result) {
        send({method:'initialized'});
        send({id:2,method,params});
      } else if (message.id === 2 && Array.isArray(message.result?.data)) {
        items.push(...collect(message.result.data));
        const cursor = message.result.nextCursor;
        if (cursor) send({id:2,method,params:{...params,cursor}});
        else finish();
      } else if (message.id === 1 || message.id === 2) {
        finish(unavailable());
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'open_studio',version:'0.1.0'}}});
  });
}

export function listCodexModels(cwd) {
  return collectCodexList(cwd,'model/list',{limit:50},models => models
    .filter(model => !model.hidden && typeof model.model === 'string')
    .map(model => ({id:model.model,label:model.displayName || model.model,
      efforts:(model.supportedReasoningEfforts || []).map(item => item.reasoningEffort).filter(effort => reasoningEfforts.includes(effort))})),
  'Could not load Codex models. Check the CLI installation and sign-in.');
}

export async function listCodexSkills(cwd) {
  const skills = await collectCodexList(cwd,'skills/list',{cwds:[cwd]},entries => entries
    .flatMap(entry => entry.skills || [])
    .filter(skill => skill.enabled && typeof skill.name === 'string')
    .map(skill => ({name:skill.name,description:skill.interface?.shortDescription || skill.shortDescription || skill.description})),
  'Could not load installed skills. Check the Codex CLI installation.');
  return [...new Map(skills.map(skill => [skill.name,skill])).values()]
    .sort((a,b) => a.name.localeCompare(b.name));
}
