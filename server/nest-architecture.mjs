import { packageManifest, resolveScript, scriptExtension, scriptStatements, usesPackage } from './project-framework.mjs';

export const isNestProject = text => usesPackage(packageManifest(text),'@nestjs/core');

function bindings(statements) {
  const imports = new Map();
  for (const statement of statements) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      if (specifier.importKind === 'type') continue;
      imports.set(specifier.local.name,{specifier:statement.source.value,
        name:specifier.imported?.name || (specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*')});
    }
  }
  return imports;
}

function registration(expression) {
  if (expression?.type === 'Identifier') return expression.name;
  // Dynamic Nest modules still name the module explicitly in imports.
  const callee = expression?.type === 'CallExpression' && expression.callee;
  if (callee?.type === 'MemberExpression' && callee.object.type === 'Identifier') return callee.object.name;
  return null;
}

export function nestModules(files) {
  const classes = new Map();
  const modules = [];
  for (const [path,text] of files) {
    if (!scriptExtension.test(path) || !/\bclass\s/.test(text)) continue;
    const statements = scriptStatements(path,text);
    const imports = bindings(statements);
    const names = new Map();
    classes.set(path,names);
    for (const statement of statements) {
      const node = statement.declaration || statement;
      if (node.type !== 'ClassDeclaration' || !node.id) continue;
      const name = node.id.name;
      const source = {path,line:node.loc.start.line};
      const record = {id:path + '#' + name,name,source,imports};
      names.set(name,record);
      if (statement.type === 'ExportDefaultDeclaration') names.set('default',record);
      const metadata = node.decorators?.map(decorator => decorator.expression).find(expression => {
        const binding = imports.get(expression.callee?.name);
        return binding?.specifier === '@nestjs/common' && binding.name === 'Module';
      })?.arguments[0];
      if (metadata?.type === 'ObjectExpression') modules.push({...record,metadata});
    }
  }
  const resolve = (module,name) => {
    const binding = module.imports.get(name);
    if (!binding) return classes.get(module.source.path)?.get(name);
    const path = resolveScript(module.source.path,binding.specifier,classes);
    return classes.get(path)?.get(binding.name);
  };
  return modules.map(module => {
    const registrations = property => module.metadata.properties.find(item => item.type === 'ObjectProperty' &&
      (item.key.name || item.key.value) === property)?.value;
    const entries = property => {
      const array = registrations(property);
      return array?.type === 'ArrayExpression' ? array.elements.flatMap(expression => {
        const name = registration(expression);
        const target = name && resolve(module,name);
        return target ? [{target,source:{path:module.source.path,line:expression.loc.start.line}}] : [];
      }) : [];
    };
    const members = new Map();
    for (const {target} of [...entries('controllers'),...entries('providers')]) {
      members.set(target.id,{label:target.name,source:target.source});
    }
    return {id:module.id,name:module.name,source:module.source,members:[...members.values()],
      imports:entries('imports').map(({target,source}) => ({to:target.id,source}))};
  });
}
