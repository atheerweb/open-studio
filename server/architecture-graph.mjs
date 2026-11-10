import { isNestProject, nestModules } from './nest-architecture.mjs';

const human = value => value.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replaceAll('_',' ')
  .replace(/\b\w/g,char=>char.toUpperCase());
const label = value => typeof value === 'string' ? value.slice(0,240) : '';
const moduleName = path => path.match(/^Modules\/([^/]+)\//i)?.[1] || (/^app\//i.test(path) ? 'Shared' : null);
const position = (path,text,index) => ({path,line:text.slice(0,index).split('\n').length});
const alternate = name => /reject|return|cancel|withdraw|declin|amend|fail/i.test(name);
const permission = text => text.match(/->can\(['"]([\w-]+)['"]\)/)?.[1];
function upstreamGraph(input,files) {
  const nodes = new Map();
  if (!Array.isArray(input?.nodes) || !Array.isArray(input?.edges)) return {nodes,edges:[]};
  for (const raw of input.nodes.slice(0,50000)) {
    if (typeof raw?.id !== 'string' || raw.id.length > 512 || !label(raw.name) || nodes.has(raw.id)) continue;
    const path = typeof raw.filePath === 'string' ? raw.filePath.replaceAll('\\','/').replace(/^\.\//,'') : '';
    const line = raw.lineRange?.[0];
    nodes.set(raw.id,{id:raw.id,label:label(raw.name),type:label(raw.type),
      description:label(raw.summary),source:files.has(path) ? {path,line:Number.isSafeInteger(line) && line > 0 ? line : 1} : undefined});
  }
  const edges = input.edges.slice(0,100000).filter(edge => edge && nodes.has(edge.source) &&
    nodes.has(edge.target) && edge.source !== edge.target);
  return {nodes,edges};
}

function upstreamLifecycles(domain) {
  const flows = new Map();
  for (const edge of domain.edges) {
    if (edge.type !== 'flow_step' || domain.nodes.get(edge.source).type !== 'flow' ||
        domain.nodes.get(edge.target).type !== 'step') continue;
    if (!flows.has(edge.source)) flows.set(edge.source,[]);
    flows.get(edge.source).push(edge);
  }
  return Array.from(flows,([id,steps]) => {
    const main = [...new Set(steps.sort((a,b)=>(Number(a.weight) || 0) - (Number(b.weight) || 0)).map(edge=>edge.target))];
    return {...domain.nodes.get(id),kind:'Understand Anything',main,nodes:main.map(key=>domain.nodes.get(key)),
      edges:main.slice(1).map((to,i)=>({from:main[i],to,label:'Next step',inferred:true}))};
  });
}

function moduleLifecycles(group,files) {
  const enums = new Map();
  for (const [path,text] of files) {
    if (!/StatusEnum\.php$/i.test(path)) continue;
    const definition = /\benum\s+(\w+StatusEnum)\b/.exec(text);
    if (!definition) continue;
    const states = new Map();
    for (const match of text.matchAll(/\bcase\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g)) {
      states.set(match[1],{id:match[1],label:human(match[2]),source:position(path,text,match.index)});
    }
    enums.set(definition[1],states);
  }
  return [...enums].map(([name,states])=>traceLifecycle(group,files,name,states,enums.size > 1)).filter(Boolean);
}

function traceLifecycle(group,files,name,states,multiple) {
  const edges = new Map();
  const transition = (from,to,source,actor) => {
    if (from !== to && states.has(from) && states.has(to)) edges.set(from + ':' + to,{from,to,label:actor || 'Transitions to',source});
  };
  for (const [path,text] of files) {
    if (/\/Strategies\/[^/]+\.php$/i.test(path)) {
      const target = /['"]status['"]\s*=>\s*(\w+StatusEnum)::(\w+)/.exec(text);
      const policy = /\bfunction\s+policy\s*\([^)]*\)[^{]*\{\s*return\s+([\s\S]*?);/.exec(text);
      if (!target || target[1] !== name || !policy || /!\s*\(/.test(policy[1])) continue;
      const conditions = policy[1];
      const matchPolicy = /^match\s*\(\s*\$this->\w+\??->status\s*\)/.test(conditions);
      const guard = new RegExp(matchPolicy ? '\\b' + name + '::(\\w+)\\s*=>\\s*(?!false\\b)(?=\\S)' :
        '\\bstatus\\s*===?\\s*' + name + '::(\\w+)','g');
      for (const match of conditions.matchAll(guard)) {
        const caseGuard = matchPolicy && conditions.slice(match.index).split('\n')[0];
        transition(match[1],target[2],position(path,text,policy.index + policy[0].length - conditions.length - 1 + match.index),
          permission(caseGuard || conditions));
      }
    } else if (/\/Services\/[^/]+\.php$/i.test(path)) {
      const draft = /['"]status['"]\s*=>\s*\$isDraft\s*\?\s*(\w+StatusEnum)::(Draft)\s*:\s*\1::(\w+)/.exec(text);
      if (draft && draft[1] === name && /if\s*\([^)]*->is_draft\s*&&\s*!\s*\$isDraft\s*\)\s*\{[\s\S]{0,250}?->enterLifeCycle\(/.test(text) &&
          new RegExp('StatusFactory::guess\\(' + draft[1] + '::' + draft[3] + '\\b').test(text)) {
        transition(draft[2],draft[3],position(path,text,draft.index),'Publishes draft');
      }
    }
  }
  if (!edges.size) return null;
  const transitions = [...edges.values()];
  const mainEdges = transitions.filter(edge=>!alternate(edge.from) && !alternate(edge.to));
  const roots = [...new Set(mainEdges.map(edge=>edge.from))].filter(id=>!mainEdges.some(edge=>edge.to === id));
  const main = [];
  for (const root of roots) {
    const path = [root];
    while (path.length < states.size) {
      const next = mainEdges.find(edge=>edge.from === path.at(-1) && !path.includes(edge.to));
      if (!next) break;
      path.push(next.to);
    }
    if (path.length > main.length) main.splice(0,main.length,...path);
  }
  if (!main.length) main.push(transitions[0].from,transitions[0].to);
  const used = new Set(transitions.flatMap(edge=>[edge.from,edge.to]));
  return {id:'local:' + group + (multiple ? ':' + name : ''),
    label:human(multiple ? name.replace(/StatusEnum$/,'') : group) + ' lifecycle',kind:'Laravel source',main,
    nodes:[...states.values()].filter(state=>used.has(state.id)),edges:transitions};
}

function systemGraph(files,laravel,nest,knowledge) {
  const nodes = [];
  const edges = [];
  const add = (id,name,kind,source,relation,inferred = false) => {
    if (nodes.some(node=>node.id === id)) return;
    nodes.push({id,label:name,type:kind,source});
    if (relation) edges.push({from:'backend',to:id,label:relation,source,inferred});
  };
  if (!laravel && !nest && !knowledge.nodes.size) return {nodes,edges};
  const found = (pattern,pathPattern) => {
    for (const [path,text] of files) {
      if (!pathPattern.test(path)) continue;
      const match = pattern.exec(text);
      if (match) return position(path,text,match.index);
    }
  };
  const manifest = laravel ? 'composer.json' : nest ? 'package.json' : null;
  add('backend',laravel ? 'Laravel API' : nest ? 'NestJS API' : 'Backend','API',manifest ? {path:manifest,line:1} : undefined);
  add('client','Client','Boundary');
  edges.push({from:'client',to:'backend',label:'Requests',inferred:true});
  if (laravel) {
    if (files.has('config/database.php')) add('database','Database','Data store',{path:'config/database.php',line:1},'Database configuration',true);
    const job = found(/\bimplements\s+(?:\\?Illuminate\\Contracts\\Queue\\)?ShouldQueue\b/,/\/Jobs\/.*\.php$/i);
    if (job) add('queue','Queue workers','Async processing',job,'Defines queued jobs');
    for (const [id,name,path] of [
      ['identity','SAML identity provider','config/saml2_settings.php'],
      ['directory','LDAP directory','config/ldap.php'],
      ['mail','Mail transport','config/mail.php'],
      ['storage','File storage','config/filesystems.php']
    ]) {
      if (files.has(path)) add(id,name,'Configured integration',{path,line:1},'Configuration present',true);
    }
  }
  for (const node of knowledge.nodes.values()) {
    if (!['service','resource','table'].includes(node.type) || nodes.length >= 24) continue;
    add('upstream:' + node.id,node.label,human(node.type),node.source,'Reported by Understand Anything',true);
  }
  return {nodes,edges};
}

export function analyzeArchitecture(files,artifacts = {}) {
  const knowledge = upstreamGraph(artifacts.knowledge,files);
  const domain = upstreamGraph(artifacts.domain,files);
  const laravel = files.get('composer.json')?.includes('"laravel/framework"') || false;
  const nest = !laravel && isNestProject(files.get('package.json'));
  const modules = new Map();
  const related = new Map();
  const sourceGroups = new Map();
  const addModule = (id,source,description) => {
    if (!modules.has(id)) modules.set(id,{id,label:human(id),source,description});
    return id;
  };
  const connect = (from,to,relation,source,inferred = false) => {
    if (!from || !to || from === to || !modules.has(from) || !modules.has(to)) return;
    const key = JSON.stringify([from,to,relation]);
    if (!related.has(key)) related.set(key,{from,to,label:relation,source,inferred});
  };
  if (laravel) {
    for (const [path,text] of files) {
      const group = moduleName(path);
      if (!group) continue;
      addModule(group,{path,line:1});
      if (!sourceGroups.has(group)) sourceGroups.set(group,new Map());
      sourceGroups.get(group).set(path,text);
    }
    for (const [group,sources] of sourceGroups) {
      const members = [...sources.keys()].filter(path=>/\/(?:routes|controllers|models|services|strategies|jobs)\/.*\.php$/i.test(path) &&
        !/\/(?:tests|database)\//i.test(path));
      modules.get(group).members = members.slice(0,30).map(path=>({label:path.split('/').at(-1),source:{path,line:1}}));
      for (const [path,text] of sources) {
        if (!/\.php$/i.test(path) || /\/(?:tests|database\/factories)\//i.test(path)) continue;
        for (const match of text.matchAll(/(?:^|\n)\s*use\s+\\?(Modules\\([\w]+)\\[\w\\]+|App\\[\w\\]+)\s*(?:;|as\s+\w+\s*;)/gi)) {
          const target = match[2] || 'Shared';
          const dispatch = target.toLowerCase() === 'notification' && /\bNotification::send\s*\(/.exec(text);
          connect(group,target,dispatch ? 'dispatches' : 'depends on',position(path,text,dispatch ? dispatch.index : match.index + (match[0].startsWith('\n') ? 1 : 0)));
        }
      }
    }
  }
  const nestSources = new Map();
  if (nest) {
    const discovered = nestModules(files);
    for (const module of discovered) {
      addModule(module.id,module.source);
      Object.assign(modules.get(module.id),{label:human(module.name),members:module.members});
      for (const source of [module.source,...module.members.map(member => member.source)]) {
        if (!nestSources.has(source.path)) nestSources.set(source.path,new Set());
        nestSources.get(source.path).add(module.id);
      }
    }
    for (const module of discovered) {
      for (const {to,source} of module.imports) connect(module.id,to,'imports',source);
    }
  }
  const upstreamGroups = new Map();
  for (const layer of Array.isArray(artifacts.knowledge?.layers) ? artifacts.knowledge.layers.slice(0,200) : []) {
    if (!label(layer?.name) || !Array.isArray(layer.nodeIds)) continue;
    for (const id of layer.nodeIds.slice(0,50000)) upstreamGroups.set(id,label(layer.name));
  }
  for (const node of knowledge.nodes.values()) {
    const owners = node.source && nestSources.get(node.source.path);
    if (owners?.size === 1) {
      upstreamGroups.set(node.id,owners.values().next().value);
      continue;
    }
    const local = node.source && moduleName(node.source.path);
    const name = local || (laravel ? null : upstreamGroups.get(node.id) || (node.type === 'module' ? node.label : null));
    if (name) upstreamGroups.set(node.id,addModule(name,node.source,node.description));
    else upstreamGroups.delete(node.id);
  }
  for (const edge of knowledge.edges) {
    if (['contains','related','similar_to','tested_by'].includes(edge.type)) continue;
    const from = edge.direction === 'backward' ? edge.target : edge.source;
    const to = edge.direction === 'backward' ? edge.source : edge.target;
    connect(upstreamGroups.get(from),upstreamGroups.get(to),label(edge.type).replaceAll('_',' '),knowledge.nodes.get(from).source,true);
    if (edge.direction === 'bidirectional') connect(upstreamGroups.get(to),upstreamGroups.get(from),
      label(edge.type).replaceAll('_',' '),knowledge.nodes.get(to).source,true);
  }
  const lifecycles = [...sourceGroups].flatMap(([group,sources])=>moduleLifecycles(group,sources));
  lifecycles.sort((a,b)=>a.label.localeCompare(b.label));
  lifecycles.push(...upstreamLifecycles(domain));
  const analyzer = [laravel ? 'Laravel source' : nest ? 'NestJS source' : null,
    (!laravel && !nest) || knowledge.nodes.size || domain.nodes.size ? 'Understand Anything' : null].filter(Boolean).join(' + ');
  return {analyzer,modules:{nodes:[...modules.values()],edges:[...related.values()]},lifecycles,
    system:systemGraph(files,laravel,nest,knowledge)};
}
