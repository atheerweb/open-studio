import React from 'react';
import {ChevronDown} from 'lucide-react';

export function Select({children, selectedLabel, ...props}) {
  return <select {...props} className="studio-select">
    <button type="button">
      {selectedLabel === undefined
        ? <selectedcontent className="studio-select-label"/>
        : <span className="studio-select-label">{selectedLabel}</span>}
      <ChevronDown className="studio-select-chevron" size={14} aria-hidden="true"/>
    </button>
    {children}
  </select>;
}
