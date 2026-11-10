import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeArchitecture} from '../server/architecture-graph.mjs';

const status = (target, policy) => `<?php
function handle() { $this->model->update(['status' => CaseStatusEnum::${target}->value]); }
function policy() { return ${policy}; }`;

test('traces a main lifecycle and an evidence-backed amendment loop', () => {
  const strategy = 'Modules/Case/app/Tools/Status/Strategies/';
  const files = new Map([
    ['composer.json',JSON.stringify({require:{'laravel/framework':'^13.0'}})],
    ['Modules/Case/app/Enum/CaseStatusEnum.php','enum CaseStatusEnum { case Pending = "pending"; case Completed = "completed"; case ReturnedForAmendment = "returned_for_amendment"; }'],
    [strategy + 'Complete.php',status('Completed',"$this->user->can('complete-case') && $this->model->status === CaseStatusEnum::Pending")],
    [strategy + 'Return.php',status('ReturnedForAmendment','$this->model->status === CaseStatusEnum::Pending')],
    [strategy + 'Submit.php',status('Pending','$this->model->status === CaseStatusEnum::ReturnedForAmendment')],
    ['Modules/Case/app/Services/CaseService.php','use Modules\\Notification\\App\\Tools\\Facades\\Notification;\nNotification::send($event);'],
    ['Modules/Notification/app/Jobs/Send.php','class Send implements ShouldQueue {}'],
    ['config/database.php','<?php return [];']
  ]);
  const graph = analyzeArchitecture(files);
  const [flow] = graph.lifecycles;
  assert.deepEqual(flow.main,['Pending','Completed']);
  assert.ok(flow.edges.some(edge => edge.from === 'ReturnedForAmendment' && edge.to === 'Pending'));
  assert.ok(flow.edges.some(edge => edge.source.path.endsWith('/Return.php')));
  assert.ok(graph.modules.edges.some(edge => edge.from === 'Case' && edge.to === 'Notification' && edge.label === 'dispatches'));
  assert.ok(graph.system.nodes.some(node => node.id === 'queue'));
});

test('imports ordered upstream flows and drops unsafe evidence and dangling relationships', () => {
  const files = new Map([['src/orders.php','start\nfinish']]);
  const graph = analyzeArchitecture(files,{domain:{
    nodes:[{id:'flow',type:'flow',name:'Order lifecycle'},
      {id:'first',type:'step',name:'Start',filePath:'src/orders.php',lineRange:[1,1]},
      {id:'last',type:'step',name:'Finish',filePath:'../.env'}],
    edges:[{source:'flow',target:'last',type:'flow_step',weight:1},
      {source:'flow',target:'missing',type:'flow_step',weight:0.5},
      {source:'flow',target:'first',type:'flow_step',weight:0.1}]
  }});
  assert.deepEqual(graph.lifecycles[0].main,['first','last']);
  assert.deepEqual(graph.lifecycles[0].nodes[0].source,{path:'src/orders.php',line:1});
  assert.equal(graph.lifecycles[0].nodes[1].source,undefined);
});

test('keeps status enums separate and omits a policy that explicitly denies a transition', () => {
  const root = 'Modules/Contract/app/';
  const files = new Map([['composer.json','{"require":{"laravel/framework":"^13.0"}}']]);
  for (const name of ['Review','Consultation','Denied']) {
    const en = name + 'StatusEnum';
    files.set(root + 'Enum/' + en + '.php',`enum ${en} { case Pending = 'pending'; case Completed = 'completed'; }`);
    const guard = `$this->model->status === ${en}::Pending`;
    const body = name === 'Denied' ? `if (${guard}) { return false; } return true;` : `return ${guard};`;
    files.set(root + 'Tools/' + name + '/Strategies/Complete.php',
      `function handle() { $this->model->update(['status' => ${en}::Completed->value]); } function policy() { ${body} }`);
  }
  const graph = analyzeArchitecture(files);
  assert.deepEqual(graph.lifecycles.map(flow=>flow.label),['Consultation lifecycle','Review lifecycle']);
  for (const flow of graph.lifecycles) {
    assert.ok(flow.nodes.every(node=>node.source.path.includes(flow.label.split(' ')[0])));
  }
});

test('isolates opt-in upstream analysis and reuses the enriched cache on reopen', async () => {
  const {execFileSync} = await import('node:child_process');
  const {mkdtemp,mkdir,readFile,realpath,rm,writeFile} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {openArchitecture} = await import('../server/architecture.mjs');
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp,'arch-test-'));
  const folder = join(root,'backend');
  const cache = join(root,'cache');
  let active;
  try {
    await mkdir(join(folder,'app'),{recursive:true});
    execFileSync('git',['init','-q'],{cwd:folder});
    await writeFile(join(folder,'composer.json'),'{"require":{"laravel/framework":"^13.0"}}');
    await writeFile(join(folder,'app','Order.php'),'<?php class Order {}');
    await writeFile(join(folder,'.env'),'SECRET=excluded');
    await writeFile(join(folder,'.gitignore'),'app/Local.php\n');
    await writeFile(join(folder,'app','Local.php'),'<?php class Ignored {}');
    await writeFile(join(folder,'AGENTS.md'),'excluded project instructions');
    let runs = 0;
    const runSkills = async snapshot=>{
      runs++;
      assert.notEqual(snapshot,folder);
      assert.match(await readFile(join(snapshot,'app','Order.php'),'utf8'),/class Order/);
      await assert.rejects(readFile(join(snapshot,'.env')), {code:'ENOENT'});
      await assert.rejects(readFile(join(snapshot,'app','Local.php')), {code:'ENOENT'});
      await assert.rejects(readFile(join(snapshot,'AGENTS.md')), {code:'ENOENT'});
      await mkdir(join(snapshot,'.ua'));
      await writeFile(join(snapshot,'.ua','knowledge-graph.json'),JSON.stringify({
        nodes:[{id:'order',type:'class',name:'Order',filePath:'app/Order.php'}],edges:[]
      }));
      await writeFile(join(snapshot,'.ua','domain-graph.json'),JSON.stringify({
        nodes:[{id:'flow',type:'flow',name:'Order lifecycle'},{id:'step',type:'step',name:'Created'}],
        edges:[{source:'flow',target:'step',type:'flow_step',weight:1}]
      }));
    };
    active = await openArchitecture(folder,cache,{runSkills});
    await active.current;
    assert.equal(runs,0);
    assert.equal(active.status().state,'ready',active.status().message);
    assert.equal(active.status().graph.analyzer,'Laravel source');
    await active.enableAI(true);
    await active.current;
    assert.equal(runs,1,active.status().warning);
    assert.equal(active.status().graph.lifecycles[0].label,'Order lifecycle');
    const first = active.status().generatedAt;
    await active.close();
    active = await openArchitecture(folder,cache,{runSkills});
    await active.current;
    assert.equal(active.status().generatedAt,first);
    assert.equal(runs,1);
    const evidence = active.status().graph.modules.nodes.find(node=>node.id === 'Shared').source;
    assert.match((await active.read(evidence)).text,/class Order/);
    await writeFile(join(folder,'app','Order.php'),'<?php class Changed {}');
    assert.equal(await active.read(evidence),null);
    await assert.rejects(readFile(join(folder,'.ua','knowledge-graph.json')),{code:'ENOENT'});
  } finally {
    await active?.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('PowerShell records successful pull and push and preserves a failed Git exit code',{skip:process.platform !== 'win32'},async () => {
  const {execFileSync} = await import('node:child_process');
  const {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} = await import('node:fs/promises');
  const {openArchitecture} = await import('../server/architecture.mjs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp,'arch-terminal-'));
  const local = join(root,'local');
  const remote = join(root,'remote');
  const cache = join(root,'cache');
  const events = join(cache,'architecture','terminal-events');
  const git = (...args)=>execFileSync('git',args,{cwd:local,stdio:'pipe'});
  let architecture;
  try {
    await mkdir(local);
    await mkdir(events,{recursive:true});
    git('init','-b','main');
    git('init','--bare',remote);
    git('remote','add','origin',remote);
    git('-c','user.name=Studio','-c','user.email=studio@example.com','commit','--allow-empty','-m','Seed');
    const bridge = fileURLToPath(new URL('../server/architecture-terminal.ps1',import.meta.url));
    const quote = value => "'" + value.replaceAll("'","''") + "'";
    const invoke = command=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',
      '. ' + quote(bridge) + ' ' + quote(events) + '; ' + command + '; Write-Output ("STATUS=" + $LASTEXITCODE)'],
      {cwd:local,encoding:'utf8',stdio:'pipe'});
    assert.match(invoke('git push -u origin main'),/STATUS=0/);
    const [marker] = await readdir(events);
    assert.ok(marker);
    const pushed = await readFile(join(events,marker),'utf8');
    assert.match(invoke("git -C '.' pull"),/STATUS=0/);
    const pulled = await readFile(join(events,marker),'utf8');
    assert.notEqual(pulled,pushed);
    assert.match(invoke('git push origin missing-branch'),/STATUS=[1-9]/);
    assert.equal(await readFile(join(events,marker),'utf8'),pulled);
    await writeFile(join(local,'composer.json'),'{"require":{"laravel/framework":"^13.0"}}');
    architecture = await openArchitecture(local,cache);
    await architecture.current;
    assert.equal(architecture.status().state,'ready',architecture.status().message);
    await mkdir(join(local,'app'));
    await writeFile(join(local,'app','Order.php'),'<?php class Order {}');
    assert.match(invoke('git push'),/STATUS=0/);
    for (let attempt = 0; attempt < 75 && !architecture.status().graph.modules.nodes.length; attempt++) {
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(architecture.status().graph.modules.nodes.some(node=>node.id === 'Shared'));
  } finally {
    await architecture?.close();
    await rm(root,{recursive:true,force:true});
  }
});
