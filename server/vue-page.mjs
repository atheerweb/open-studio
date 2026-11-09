import { posix } from 'node:path';

export function routeFiles(routerFile, source, knownFiles) {
  const records = [];
  const pattern = /(?:^|[{,\n])\s*path\s*:\s*(['"])(\/[^'"\\\r\n]*)\1\s*,\s*(?:name\s*:\s*(['"])[^'"\\\r\n]+\3\s*,\s*)?component\s*:\s*\(\s*\)\s*=>\s*import\(\s*(['"])([^'"\\\r\n]+\.vue)\4\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, , route, , , specifier] = match;
    const file = specifier.startsWith('@/') ? 'src/' + specifier.slice(2)
      : specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(routerFile), specifier)) : '';
    if (knownFiles.has(file)) records.push({route,file});
  }
  return records;
}

export function matchPage(records, route) {
  const exact = records.filter(record => record.route === route);
  const parts = route.split('/');
  const matches = exact.length ? exact : records.filter(record => {
    const pattern = record.route.split('/');
    return pattern.length === parts.length && pattern.every((part, index) =>
      /^:[A-Za-z_]\w*$/.test(part) ? Boolean(parts[index]) : part === parts[index]
    );
  });
  const files = new Set(matches.map(record => record.file));
  return files.size === 1 ? files.values().next().value : null;
}

export function routeBridge(studioOrigin) {
  return '(' + previewBridge.toString() + ')(' + JSON.stringify(studioOrigin) + ');';
}

function previewBridge(studioOrigin) {
  if (parent === window) return;
  let last;
  let picking = false;
  let outline;
  const update = (force = false) => {
    const path = location.hash.startsWith('#/') ? location.hash.slice(1).split('?')[0] : location.pathname;
    if (force === true || path !== last) {
      last = path;
      parent.postMessage({type:'studio-vue-route',route:path},studioOrigin);
    }
  };
  const clearOutline = () => { outline?.remove(); outline = undefined; };
  const describe = element => {
    let owner = element;
    while (owner && !owner.__vueParentComponent) owner = owner.parentElement;
    let component = owner?.__vueParentComponent;
    const name = component?.type?.__name || component?.type?.name || null;
    while (component && !component.type?.__file && !component.vnode?.type?.__file) component = component.parent;
    const path = [];
    for (let node = element; node?.localName && path.length < 5; node = node.parentElement) {
      const siblings = Array.from(node.parentElement?.children || []).filter(item => item.localName === node.localName);
      path.unshift(node.localName + (node.id ? '#' + node.id : siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
      if (node.id) break;
    }
    return {component:component?.type?.__file || component?.vnode?.type?.__file || null,
      componentName:name,element:{tag:element.localName,id:(element.id || '').slice(0,120),
        path:path.join(' > ').slice(0,250),label:(element.getAttribute('aria-label') ||
        element.textContent || '').trim().replace(/\s+/g,' ').slice(0,160)}};
  };
  update();
  setInterval(update,300);
  window.addEventListener('message',event => {
    if (event.source !== parent || event.origin !== studioOrigin) return;
    if (event.data?.type === 'studio-vue-hello') update(true);
    if (event.data?.type === 'studio-vue-pick') {
      picking = event.data.active === true;
      if (!picking) clearOutline();
    }
  });
  window.addEventListener('pointermove',event => {
    if (!picking || !(event.target instanceof Element)) return;
    if (!outline) {
      outline = document.createElement('div');
      outline.setAttribute('aria-hidden','true');
      Object.assign(outline.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',
        boxSizing:'border-box',border:'2px solid #3162ee',background:'rgba(49,98,238,.12)',borderRadius:'3px'});
      document.documentElement.append(outline);
    }
    const {left,top,width,height} = event.target.getBoundingClientRect();
    Object.assign(outline.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
  },true);
  window.addEventListener('pointerleave',clearOutline);
  window.addEventListener('scroll',clearOutline,true);
  window.addEventListener('keydown',event => {
    if (!picking || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    picking = false;
    clearOutline();
    parent.postMessage({type:'studio-vue-pick-cancel'},studioOrigin);
  },true);
  window.addEventListener('click',event => {
    if (!picking || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    picking = false;
    clearOutline();
    update();
    parent.postMessage({type:'studio-vue-selection',route:last,...describe(event.target)},studioOrigin);
  },true);
}

export function applyPageEdit(source, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).length !== 2 || typeof patch.find !== 'string' || !patch.find ||
      typeof patch.replace !== 'string' || patch.find.length > 8000 || patch.replace.length > 8000) {
    throw new Error('The model returned an invalid Vue edit.');
  }
  const position = source.indexOf(patch.find);
  if (position === -1 || source.indexOf(patch.find, position + 1) !== -1) {
    throw new Error('The proposed change does not match a unique span of the current source.');
  }
  return source.slice(0,position) + patch.replace + source.slice(position + patch.find.length);
}
