import React, {useEffect, useRef, useState} from 'react';
import {Database, KeyRound, LoaderCircle, Pencil, RefreshCw, Search, Table2} from 'lucide-react';

const initialConnection = {host:'localhost',port:'3306',user:'',password:'',database:'',tls:false};

function CellEditor({edit,table,saving,error,onSave,onClose}) {
  const dialog = useRef(null);
  const [value,setValue] = useState(edit.previous ?? '');
  const [isNull,setIsNull] = useState(edit.previous === null);
  const next = isNull ? null : value;

  useEffect(()=>{
    const element = dialog.current;
    element.showModal();
    return ()=>element.close();
  },[]);

  return <dialog ref={dialog} className="database-editor" aria-labelledby="database-editor-title"
    onCancel={event=>{event.preventDefault(); if (!saving) onClose();}}>
    <form onSubmit={event=>{event.preventDefault(); onSave(next);}}>
      <h2 id="database-editor-title">Edit cell</h2>
      <p className="database-editor-context"><strong>{table}.{edit.column.name}</strong> <code>{edit.column.type}</code></p>
      <label htmlFor="database-cell-value">Value</label>
      <textarea id="database-cell-value" rows={5} value={value} disabled={isNull || saving}
        autoFocus={!isNull} maxLength={32768} onChange={event=>setValue(event.target.value)}/>
      {edit.column.nullable && <label className="database-checkbox">
        <input type="checkbox" checked={isNull} disabled={saving} autoFocus={isNull}
          onChange={event=>setIsNull(event.target.checked)}/> Set to NULL
      </label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="database-editor-actions">
        <button type="button" className="quiet" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={saving || next === edit.previous}>
          {saving ? 'Saving…' : 'Save cell'}
        </button>
      </div>
    </form>
  </dialog>;
}

export function DatabasePanel({api,hidden}) {
  const [connection,setConnection] = useState(initialConnection);
  const [tables,setTables] = useState(null);
  const [filter,setFilter] = useState('');
  const [table,setTable] = useState('');
  const [preview,setPreview] = useState(null);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [edit,setEdit] = useState(null);
  const [editError,setEditError] = useState('');
  const editTrigger = useRef(null);
  const restoreEditFocus = useRef(false);

  useEffect(()=>{
    if (busy || !restoreEditFocus.current) return;
    restoreEditFocus.current = false;
    editTrigger.current?.focus();
  },[busy]);

  function field(event) {
    const {name,value,checked,type} = event.target;
    setConnection(current=>({...current,[name]:type === 'checkbox' ? checked : value}));
  }

  function request(name,update) {
    return api('database',{
      connection:{...connection,host:connection.host.trim(),port:Number(connection.port)},
      table:name,update
    });
  }

  async function loadRows(name) {
    setBusy('Loading rows…');
    setError('');
    setTable(name);
    if (name !== table) setPreview(null);
    try {
      setPreview(await request(name));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }

  async function connect(event) {
    event.preventDefault();
    setBusy('Connecting…');
    setError('');
    try {
      const result = await request();
      setTables(result.tables);
      if (result.tables.length) await loadRows(result.tables[0]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }

  function disconnect() {
    setTables(null);
    setTable('');
    setFilter('');
    setPreview(null);
    setError('');
    setNotice('');
    setConnection(current=>({...current,password:''}));
  }

  async function save(value) {
    setBusy('Saving…');
    setEditError('');
    try {
      await request(table,{column:edit.column.name,key:edit.key,previous:edit.previous,value});
    } catch (failure) {
      setEditError(failure.message);
      setBusy('');
      return;
    }
    setEdit(null);
    setNotice('Cell saved.');
    restoreEditFocus.current = true;
    await loadRows(table);
  }

  const filtered = tables?.filter(name=>name.toLowerCase().includes(filter.trim().toLowerCase()));
  const canEdit = preview?.rowKeys.some((key,index)=>key && preview.columnDetails.some((column,i)=>
    column.editable && !preview.truncated[index].includes(i)));
  return <section className="source-box database-panel" aria-labelledby="database-heading" hidden={hidden}>
    <div className="source-head database-head">
      <Database size={16} aria-hidden="true"/>
      <h2 id="database-heading" title={tables ? connection.database : undefined}>{tables ? connection.database : 'MySQL'}</h2>
      {tables && <>
        <span className="database-endpoint" title={connection.host}>{connection.host}:{connection.port}</span>
        <small className="source-state">Connected</small>
        <button type="button" className="quiet" disabled={!!busy} onClick={disconnect}>Disconnect</button>
      </>}
    </div>
    {tables === null ? <form className="database-form" onSubmit={connect}>
      <h3>Connect to MySQL</h3>
      <p>Browse your tables and edit individual cells.</p>
      <fieldset disabled={!!busy} aria-label="MySQL connection">
        <div className="database-address">
          <label>Host<input name="host" value={connection.host} onChange={field} required maxLength={253}/></label>
          <label>Port<input name="port" type="number" min="1" max="65535" value={connection.port} onChange={field} required/></label>
        </div>
        <label>Database<input name="database" value={connection.database} onChange={field} required maxLength={64}/></label>
        <label>User<input name="user" value={connection.user} onChange={field} autoComplete="off" required maxLength={128}/></label>
        <label>Password<input name="password" type="password" value={connection.password} onChange={field}
          autoComplete="off" maxLength={1024}/></label>
        <label className="database-checkbox">
          <input name="tls" type="checkbox" checked={connection.tls} onChange={field}/> Require verified TLS
        </label>
        <button type="submit" className="primary">
          {busy ? <LoaderCircle size={16} aria-hidden="true"/> : <Database size={16} aria-hidden="true"/>}
          {busy || 'Connect'}
        </button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form> : <div className="database-browser">
      <nav className="database-sidebar" aria-label="Database tables">
        <div className="database-list-head"><strong>Tables</strong><span>{tables.length}</span></div>
        {tables.length > 0 && <label className="search">
          <Search size={14} aria-hidden="true"/>
          <input aria-label="Filter tables" placeholder="Filter tables…" value={filter} onChange={event=>setFilter(event.target.value)}/>
        </label>}
        {filtered.length > 0 ? <ul>
          {filtered.map(name=><li key={name}>
            <button type="button" title={name} aria-current={name === table ? 'true' : undefined} disabled={!!busy}
              onClick={()=>{setNotice(''); void loadRows(name);}}>
              <Table2 size={15} aria-hidden="true"/><span>{name}</span>
            </button>
          </li>)}
        </ul> : <p>{tables.length ? 'No matching tables.' : 'No tables found.'}</p>}
      </nav>
      <div className="database-content">
        {table ? <>
          <div className="database-tools">
            <h3 title={table}>{table}</h3>
            {preview && <small className="source-state">{canEdit ? 'Editable' : 'Read-only'}</small>}
            <button type="button" className="quiet" aria-label="Refresh rows" title="Refresh rows" disabled={!!busy}
              onClick={()=>{setNotice(''); void loadRows(table);}}><RefreshCw size={16} aria-hidden="true"/></button>
          </div>
          <div className="database-feedback">
            {busy && !edit && <p role="status">{busy}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="database-saved" role="status">{notice}</p>}
            {preview && !busy && !error && <p>
              {preview.hasMore ? 'First ' : ''}{preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'}
              {canEdit ? ' · Select a cell to edit.' : preview.readOnlyReason ? ' · ' + preview.readOnlyReason : ''}
            </p>}
          </div>
          {preview && <div className="database-result" role="region" aria-label="Table rows" tabIndex={0}>
            <table aria-label={table}>
              <thead><tr>{preview.columnDetails.map(column=><th key={column.name} scope="col">
                <span>{column.primary && <KeyRound size={12} aria-label="Primary key" role="img"/>}{column.name}</span>
                {column.type && <small>{column.type}</small>}
              </th>)}</tr></thead>
              <tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((value,i)=>{
                const column = preview.columnDetails[i];
                const key = preview.rowKeys[index];
                const editable = column.editable && key && !preview.truncated[index].includes(i);
                const content = value === null ? <em>NULL</em> : value;
                return <td key={column.name}>{editable ? <button type="button" className="database-cell"
                  title="Edit cell" disabled={!!busy} onClick={event=>{
                    editTrigger.current = event.currentTarget;
                    setEditError('');
                    setEdit({column,key,previous:value});
                  }}>
                  <span className="sr-only">{'Edit ' + column.name + ' in row ' + (index + 1) + '. Current value: '}</span>
                  <span>{content}</span><Pencil size={13} aria-hidden="true"/>
                </button> : <span className="database-cell-value">{content}</span>}</td>;
              })}</tr>)}</tbody>
            </table>
          </div>}
        </> : <div className="empty-source"><Table2 size={28} aria-hidden="true"/>
          <h2>No tables to show</h2><p>Reconnect after creating a table in MySQL.</p>
        </div>}
      </div>
    </div>}
    {edit && <CellEditor edit={edit} table={table} saving={!!busy} error={editError}
      onSave={save} onClose={()=>setEdit(null)}/>}
  </section>;
}
