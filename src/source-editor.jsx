import React, {useEffect, useRef} from 'react';
import {basicSetup, EditorView} from 'codemirror';
import {Compartment, EditorState} from '@codemirror/state';
import {tags} from '@lezer/highlight';
import {vscodeDarkInit} from '@uiw/codemirror-theme-vscode';
import {sourceLanguage} from './source-language.mjs';

const editMode = disabled => [EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)];
const studioTheme = vscodeDarkInit({settings:{
  background:'var(--editor-bg)',
  foreground:'var(--ink)',
  caret:'var(--accent)',
  selection:'var(--focus-glow)',
  selectionMatch:'var(--focus-glow)',
  lineHighlight:'var(--editor-line)',
  fontFamily:'var(--font-code)',
  gutterBackground:'var(--editor-bg)',
  gutterForeground:'var(--muted)',
  gutterActiveForeground:'var(--accent)'
},styles:[
  {tag:[tags.keyword,tags.controlKeyword,tags.moduleKeyword,tags.operatorKeyword,tags.modifier,tags.self],color:'var(--syntax-keyword)'},
  {tag:[tags.string,tags.special(tags.string),tags.regexp,tags.escape],color:'var(--syntax-string)'},
  {tag:[tags.typeName,tags.className,tags.tagName,tags.attributeName,tags.namespace,tags.macroName,tags.labelName],color:'var(--syntax-type)'},
  {tag:[tags.number,tags.bool,tags.null,tags.atom,tags.constant(tags.name)],color:'var(--syntax-literal)'},
  {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],color:'var(--syntax-call)'},
  {tag:[tags.comment,tags.meta,tags.angleBracket],color:'var(--syntax-comment)'},
  {tag:[tags.name,tags.variableName,tags.propertyName,tags.definition(tags.name),tags.operator,tags.punctuation,tags.separator],color:'var(--ink)'},
  {tag:[tags.heading,tags.strong],fontWeight:'bold'},
  {tag:tags.emphasis,fontStyle:'italic'},
  {tag:[tags.link,tags.url],color:'var(--syntax-call)',textDecoration:'underline'},
  {tag:tags.inserted,color:'var(--success)'},
  {tag:tags.deleted,color:'var(--error)'},
  {tag:tags.invalid,color:'var(--error)'}
]});

export default function SourceEditor({file,value,onChange,disabled}) {
  const host = useRef(null);
  const editor = useRef(null);
  const mode = useRef(new Compartment());
  const initial = useRef({value,disabled});
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const language = new Compartment();
    const view = new EditorView({
      parent:host.current,
      doc:initial.current.value,
      extensions:[
        basicSetup,language.of([]),studioTheme,
        EditorView.contentAttributes.of({'aria-label':'Source editor','spellcheck':'false'}),
        mode.current.of(editMode(initial.current.disabled)),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            change.current(initial.current.value.includes('\r\n') ? text.replaceAll('\n','\r\n') : text);
          }
        })
      ]
    });
    editor.current = view;
    sourceLanguage(file).then(support => {
      if (support && editor.current === view) view.dispatch({effects:language.reconfigure(support)});
    }).catch(() => {});
    return () => { editor.current = null; view.destroy(); };
  },[]);

  useEffect(() => {
    const view = editor.current;
    const text = value.replace(/\r\n|\r/g,'\n');
    if (view && text !== view.state.doc.toString()) {
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text}});
    }
  },[value]);

  useEffect(() => {
    editor.current?.dispatch({effects:mode.current.reconfigure(editMode(disabled))});
  },[disabled]);

  return <div ref={host} className="source-editor"/>;
}
