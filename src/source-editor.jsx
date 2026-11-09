import React, {useEffect, useRef} from 'react';
import {basicSetup, EditorView} from 'codemirror';
import {Compartment, EditorState} from '@codemirror/state';
import {vue} from '@codemirror/lang-vue';
import {vscodeDark} from '@uiw/codemirror-theme-vscode';

const editMode = disabled => [EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)];

export default function SourceEditor({value,onChange,disabled}) {
  const host = useRef(null);
  const editor = useRef(null);
  const mode = useRef(new Compartment());
  const initial = useRef({value,disabled});
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent:host.current,
      doc:initial.current.value,
      extensions:[
        basicSetup,vue(),vscodeDark,
        EditorView.contentAttributes.of({'aria-label':'Vue draft source','spellcheck':'false'}),
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
