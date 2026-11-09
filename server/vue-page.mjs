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
  let overlay;
  let touchStart;
  const update = (force = false) => {
    const path = location.hash.startsWith('#/') ? location.hash.slice(1).split('?')[0] : location.pathname;
    if (force === true || path !== last) {
      last = path;
      parent.postMessage({type:'studio-vue-route',route:path},studioOrigin);
    }
  };
  const clearOutline = () => { if (overlay) overlay.host.style.opacity = '0'; };
  const highlight = element => {
    const {left,top,width,height} = element.getBoundingClientRect();
    if (width <= 0 || height <= 0) return clearOutline();
    if (!overlay) {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden','true');
      host.setAttribute('data-open-studio-picker','');
      const root = host.attachShadow({mode:'closed'});
      const outline = document.createElement('div');
      const label = document.createElement('span');
      Object.assign(host.style,{all:'initial',position:'fixed',inset:'0',pointerEvents:'none',
        zIndex:'2147483647',opacity:'0'});
      Object.assign(outline.style,{position:'absolute',boxSizing:'border-box',
        border:'2px solid #c1fa48',borderRadius:'4px',background:'rgba(193,250,72,.10)',
        boxShadow:'0 0 0 1px #202711, inset 0 0 0 1px #202711'});
      Object.assign(label.style,{position:'absolute',padding:'3px 7px',borderRadius:'5px',
        maxWidth:'calc(100vw - 8px)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
        font:'600 11px/16px ui-monospace,monospace',color:'#202711',background:'#c1fa48',
        boxShadow:'0 0 0 1px #202711'});
      root.append(outline,label);
      document.documentElement.append(host);
      overlay = {host,outline,label};
      host.getBoundingClientRect();
    }
    const {host,outline,label} = overlay;
    Object.assign(outline.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});
    label.textContent = '<' + element.localName + (element.id ? '#' + element.id.slice(0,48) : '') +
      '>  ' + Math.round(width) + ' \u00d7 ' + Math.round(height);
    label.style.top = Math.max(4,Math.min(window.innerHeight - 26,top >= 28 ? top - 26 : top + 4))+'px';
    label.style.left = Math.max(4,Math.min(left,window.innerWidth - label.offsetWidth - 4))+'px';
    host.style.transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'opacity 120ms ease-out';
    host.style.opacity = '1';
  };
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
      touchStart = undefined;
      if (!picking) clearOutline();
    }
  });
  const highlightTarget = event => {
    if (picking && event.pointerType !== 'touch' && event.target instanceof Element) highlight(event.target);
  };
  window.addEventListener('pointermove',highlightTarget,true);
  window.addEventListener('focusin',highlightTarget,true);
  window.addEventListener('pointerleave',clearOutline);
  window.addEventListener('scroll',() => {
    touchStart = undefined;
    clearOutline();
  },true);
  window.addEventListener('blur',clearOutline);
  const select = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    picking = false;
    clearOutline();
    update();
    parent.postMessage({type:'studio-vue-selection',route:last,...describe(event.target)},studioOrigin);
  };
  window.addEventListener('keydown',event => {
    if (!picking) return;
    if (event.key === 'Enter' && event.target instanceof Element &&
        event.target !== document.body && event.target !== document.documentElement) return select(event);
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    picking = false;
    clearOutline();
    parent.postMessage({type:'studio-vue-pick-cancel'},studioOrigin);
  },true);
  window.addEventListener('click',event => {
    if (picking && event.target instanceof Element) select(event);
  },true);
  window.addEventListener('touchstart',event => {
    touchStart = picking && event.touches.length === 1 ? event.touches[0] : undefined;
  },{capture:true,passive:true});
  window.addEventListener('touchcancel',() => { touchStart = undefined; },true);
  window.addEventListener('touchend',event => {
    const start = touchStart;
    touchStart = undefined;
    if (!picking || !start || !(event.target instanceof Element)) return;
    const end = Array.from(event.changedTouches).find(touch=>touch.identifier === start.identifier);
    if (end && Math.hypot(end.clientX - start.clientX,end.clientY - start.clientY) <= 10) select(event);
  },{capture:true,passive:false});
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
