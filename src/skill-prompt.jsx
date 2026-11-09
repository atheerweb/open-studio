import React, {useEffect, useRef, useState} from 'react';

function skillToken(input) {
  const {value, selectionStart, selectionEnd} = input;
  if (selectionStart !== selectionEnd) return null;
  const match = /(?:^|\s)\\([\w:-]*)$/.exec(value.slice(0,selectionStart));
  if (!match) return null;
  const suffix = /^[\w:-]*/.exec(value.slice(selectionStart))[0];
  return {query:match[1].toLowerCase(),start:selectionStart-match[1].length-1,end:selectionStart+suffix.length};
}

export function SkillPrompt({value, onChange, loadSkills}) {
  const input = useRef(null);
  const caret = useRef(null);
  const [token,setToken] = useState(null);
  const [catalog,setCatalog] = useState(null);
  const [active,setActive] = useState(0);
  const open = !!token;
  const matches = open ? (catalog?.skills || []).filter(skill => skill.name.toLowerCase().includes(token.query)) : [];

  useEffect(() => {
    if (!open) return;
    let current = true;
    loadSkills().then(
      result => { if (current) setCatalog(result); },
      () => { if (current) setCatalog({error:true}); }
    );
    return () => { current = false; };
  },[open,loadSkills]);

  useEffect(() => {
    if (caret.current === null) return;
    input.current.setSelectionRange(caret.current,caret.current);
    caret.current = null;
  },[value]);

  function updateToken(next) {
    if (!next || !open) setCatalog(null);
    if (next?.query !== token?.query) setActive(0);
    setToken(next);
  }

  function choose(skill) {
    const suffix = value.slice(token.end);
    const mention = '$' + skill.name + (/^\s/.test(suffix) ? '' : ' ');
    const next = value.slice(0,token.start) + mention + suffix;
    if (next.length > input.current.maxLength) return;
    caret.current = token.start + mention.length;
    onChange(next);
    updateToken(null);
  }

  function handleKey(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      updateToken(null);
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      updateToken(null);
    } else if (matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      setActive(next);
      document.getElementById('skill-option-' + next)?.scrollIntoView({block:'nearest'});
    } else if (event.key === 'Enter' && matches[active]) {
      event.preventDefault();
      choose(matches[active]);
    }
  }

  return <>
    <textarea ref={input} id="prompt" rows="3" maxLength={16000}
      placeholder="Describe a change or ask a question…" value={value}
      aria-describedby="composer-hint" dir="auto"
      aria-autocomplete="list" aria-controls={matches.length ? 'installed-skills' : undefined}
      aria-activedescendant={matches[active] ? 'skill-option-' + active : undefined}
      onChange={event=>{onChange(event.target.value);updateToken(skillToken(event.target));}}
      onSelect={event=>{if (open) updateToken(skillToken(event.target));}}
      onKeyDown={handleKey} onBlur={()=>updateToken(null)}/>
    {open && <div className="skill-picker">
      <div className="skill-picker-heading">Installed skills</div>
      {matches.length ? <div id="installed-skills" role="listbox" aria-label="Installed skills">
        {matches.map((skill,index)=><div key={skill.name} id={'skill-option-' + index}
          role="option" aria-selected={index === active}
          onMouseDown={event=>event.preventDefault()} onClick={()=>choose(skill)}>
          <strong>{skill.name}</strong>
          {skill.description && <small>{skill.description}</small>}
        </div>)}
      </div> : <p role="status">{!catalog ? 'Loading skills…' : catalog.error
        ? 'Couldn’t load skills. Check the Codex CLI and try again.'
        : catalog.skills.length ? 'No matching skills.' : 'No installed skills found.'}</p>}
    </div>}
  </>;
}
