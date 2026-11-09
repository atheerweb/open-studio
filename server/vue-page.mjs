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
  return '(() => {' +
    'if (parent === window) return;' +
    'let last; const update = () => {' +
    'const path = location.hash.startsWith("#/") ? location.hash.slice(1).split("?")[0] : location.pathname;' +
    'if (path !== last) { last = path; parent.postMessage({type:"studio-vue-route",route:path},' + JSON.stringify(studioOrigin) + '); }' +
    '}; update(); setInterval(update, 300);' +
    '})();';
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
