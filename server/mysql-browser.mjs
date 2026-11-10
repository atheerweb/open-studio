import mysql from 'mysql2/promise';

const previewLimit = 50;
const previewLength = 500;
const maxEditLength = 32768;
const requestError = (status,message) => Object.assign(new Error(message),{status});
const text = (value,max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const identifier = name => mysql.escapeId(name,true);
const query = (client,sql,options) => client.query({sql,timeout:5000,...options});
const editableType = /^(?:tinyint|smallint|mediumint|int|bigint|decimal|char|varchar|tinytext|text|mediumtext|longtext|date|datetime|timestamp|time|year|enum|set|json)\b/i;
const keyType = /^(?:tinyint|smallint|mediumint|int|bigint|char|varchar|decimal)\b/i;
const fullValue = value => value === null || (!Buffer.isBuffer(value) && String(value).length <= previewLength);

function previewValue(value) {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return '[Binary: ' + value.length + ' bytes]';
  const display = String(value);
  return display.length > previewLength ? display.slice(0,previewLength) + '…' : display;
}

async function tableSchema(client,table,engine) {
  const [columns] = await query(client,'SHOW FULL COLUMNS FROM ' + table,{rowsAsArray:false});
  const [indexes] = await query(client,"SHOW INDEX FROM " + table + " WHERE Key_name = 'PRIMARY'",{rowsAsArray:false});
  const primaryKey = indexes.sort((a,b)=>a.Seq_in_index-b.Seq_in_index).map(index=>index.Column_name);
  const keyed = primaryKey.length > 0 && primaryKey.every(name=>
    columns.some(column=>column.Field === name && keyType.test(column.Type)));
  const readOnlyReason = !primaryKey.length ? 'This table has no primary key.' :
    !keyed ? 'This table uses a primary key type Studio cannot edit safely.' :
    engine !== 'InnoDB' ? 'Editing is available for InnoDB tables.' : '';
  const details = columns.map(column=>({
    name:column.Field,
    type:column.Type,
    nullable:column.Null === 'YES',
    primary:primaryKey.includes(column.Field),
    editable:!readOnlyReason && !primaryKey.includes(column.Field) && editableType.test(column.Type) &&
      !/auto_increment|(?:stored|virtual) generated/i.test(column.Extra) &&
      column.Privileges?.split(',').includes('update') === true
  }));
  return {primaryKey,details,readOnlyReason};
}

async function updateCell(client,table,{primaryKey,details},update) {
  const {column,key,previous,value} = update ?? {};
  const field = details.find(detail=>detail.name === column);
  const validValue = (entry,max) => entry === null || (typeof entry === 'string' && entry.length <= max);
  if (!field?.editable || !Array.isArray(key) || key.length !== primaryKey.length ||
      !key.every(part=>typeof part === 'string' && part.length <= previewLength) ||
      !validValue(previous,previewLength) || !validValue(value,maxEditLength) || (value === null && !field.nullable)) {
    throw requestError(400,'This cell or value cannot be edited.');
  }
  // Match exact values even when the column uses a case-insensitive collation.
  const exact = name => 'CAST(CAST(' + name + ' AS CHAR CHARACTER SET utf8mb4) AS BINARY) <=> CAST(? AS BINARY)';
  const target = identifier(column);
  const predicates = primaryKey.map(name=>{
    const id = identifier(name);
    return id + ' = ? AND ' + exact(id);
  });
  await query(client,'START TRANSACTION');
  const [result] = await client.execute({
    sql:'UPDATE ' + table + ' SET ' + target + ' = ? WHERE ' +
      [...predicates,exact(target)].join(' AND ') + ' LIMIT 1',
    timeout:5000
  },[value,...key.flatMap(part=>[part,part]),previous]);
  // Closing the connection rolls back an unsuccessful edit.
  if (!result.affectedRows) throw requestError(409,'The cell changed or the row was removed. Refresh rows before editing again.');
  if (result.warningStatus) throw requestError(422,'MySQL would adjust this value. Enter a value that fits the column.');
  await query(client,'COMMIT');
  return {saved:true};
}

export async function browseMySql(connection,table,update) {
  const {host,port,user,password,database,tls} = connection ?? {};
  if (!text(host,253) || !/^[\w.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !text(user,128) || !user || !text(password,1024) || !text(database,64) || !database || typeof tls !== 'boolean') {
    throw requestError(400,'Enter a valid MySQL host, port, user, and database.');
  }
  if ((table !== undefined || update !== undefined) && (!text(table,64) || !table)) {
    throw requestError(400,'Choose a MySQL table.');
  }
  let client;
  try {
    client = await mysql.createConnection({
      host,port,user,password,database,connectTimeout:5000,flags:'-LOCAL_FILES',
      ssl:tls ? {rejectUnauthorized:true,verifyIdentity:true} : undefined,
      rowsAsArray:true,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,jsonStrings:true
    });
    const [entries] = await query(client,
      'SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ' +
      "AND CAST(TABLE_SCHEMA AS BINARY) = CAST(DATABASE() AS BINARY) AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    if (table === undefined) return {tables:entries.map(([name])=>name)};
    const entry = entries.find(([name])=>name === table);
    if (!entry) throw requestError(404,'This table is unavailable.');
    const quotedTable = identifier(table);
    const schema = await tableSchema(client,quotedTable,entry[1]);
    if (update !== undefined) return await updateCell(client,quotedTable,schema,update);
    const {primaryKey,details,readOnlyReason} = schema;
    const order = primaryKey.length ? ' ORDER BY ' + primaryKey.map(identifier).join(', ') : '';
    const [rows,fields] = await query(client,'SELECT * FROM ' + quotedTable + order + ' LIMIT ' + (previewLimit + 1));
    const columns = fields.map(field=>field.name);
    const keyIndexes = primaryKey.map(name=>columns.indexOf(name));
    const sample = rows.slice(0,previewLimit);
    return {
      columns,
      primaryKey,
      columnDetails:columns.map(name=>details.find(detail=>detail.name === name) ?? {name}),
      readOnlyReason,
      rowKeys:sample.map(row=>{
        const parts = keyIndexes.map(index=>row[index]);
        return readOnlyReason || !parts.every(part=>part != null && fullValue(part)) ? null : parts.map(String);
      }),
      truncated:sample.map(row=>row.flatMap((value,index)=>fullValue(value) ? [] : [index])),
      rows:sample.map(row=>row.map(previewValue)),
      hasMore:rows.length > previewLimit
    };
  } catch (error) {
    if (error.status) throw error;
    const message = {
      ER_ACCESS_DENIED_ERROR:'MySQL rejected the username or password.',
      ER_BAD_DB_ERROR:'MySQL could not find that database.',
      ER_DBACCESS_DENIED_ERROR:'This user cannot access that database.',
      ER_TABLEACCESS_DENIED_ERROR:'This user does not have permission for this table.',
      ER_COLUMNACCESS_DENIED_ERROR:'This user does not have permission for this column.',
      ER_DATA_TOO_LONG:'This value is too long for the column.',
      ER_TRUNCATED_WRONG_VALUE_FOR_FIELD:'This value does not match the column type.',
      ER_WARN_DATA_OUT_OF_RANGE:'This value is outside the column’s allowed range.',
      ER_DUP_ENTRY:'This value would duplicate a unique entry.',
      ECONNREFUSED:'Could not reach MySQL. Check the host and port.',
      ENOTFOUND:'Could not resolve the MySQL host.',
      ETIMEDOUT:'The MySQL connection timed out.',
      PROTOCOL_SEQUENCE_TIMEOUT:'The MySQL query timed out.'
    }[error.code];
    throw requestError(422,message || 'MySQL could not complete the request. Check the connection and permissions.');
  } finally {
    client?.destroy();
  }
}
