import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2';
import { createStudio } from '../server/studio.mjs';

test('browses MySQL through the workspace API and restricts previews to listed tables', async () => {
  const table = 'order`items';
  const id = '9223372036854775807';
  let stored = null;
  let writes = 0;
  const connections = new Set();
  const serverErrors = [];
  const mysqlServer = mysql.createServer(connection => {
    let pending = stored;
    connections.add(connection);
    connection.on('error',error => {
      if (error.code !== 'PROTOCOL_CONNECTION_LOST') serverErrors.push(error);
    });
    connection.stream.once('close',()=>connections.delete(connection));
    connection.serverHandshake({protocolVersion:10,serverVersion:'8.4.0',connectionId:1,
      statusFlags:2,characterSet:45,capabilityFlags:0x00088208,authCallback({user},reply) {
        reply(null,user === 'reader' ? null : {code:1045,message:'Private server details'});
        connection._resetSequenceId();
      }});
    connection.on('query',query => {
      const result = (rows,columns) => {
        connection.writeColumns(columns.map(([name,columnType])=>({
          catalog:'def',schema:'sample',table:'',orgTable:'',name,orgName:name,
          columnType,characterSet:45,columnLength:255,flags:0,decimals:0
        })));
        for (const row of rows) connection.writeTextRow(row);
        connection.writeEof();
      };
      if (query.startsWith('SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES')) {
        result([[table,'InnoDB'],['unkeyed','InnoDB']],[['TABLE_NAME',253],['ENGINE',253]]);
      } else if (query.startsWith('SHOW FULL COLUMNS FROM ')) {
        result([['id','bigint','NO','auto_increment','select,update'],['name','varchar(120)','YES','','select,update']],
          ['Field','Type','Null','Extra','Privileges'].map(name=>[name,253]));
      } else if (query.startsWith('SHOW INDEX FROM ')) {
        result(query.includes('unkeyed') ? [] : [['id',1]],[['Column_name',253],['Seq_in_index',3]]);
      } else if (query === 'SELECT * FROM `order``items` ORDER BY `id` LIMIT 51') {
        result(Array.from({length:51},()=>[id,stored]),[['id',8],['name',253]]);
      } else if (query === 'START TRANSACTION') {
        connection.writeOk();
      } else if (query === 'COMMIT') {
        stored = pending;
        connection.writeOk();
      } else {
        connection.writeError({code:1064,message:'Unexpected query'});
      }
      connection._resetSequenceId();
    });
    connection.on('stmt_prepare',query => {
      if (!query.startsWith('UPDATE `order``items` SET `name` = ? WHERE `id` = ?') ||
          !query.includes('`name` AS CHAR CHARACTER SET utf8mb4') || !query.endsWith('LIMIT 1')) {
        connection.writeError({code:1064,message:'Unexpected prepared statement'});
      } else {
        // The fixture accepts execute parameters and returns only an OK packet.
        const header = Buffer.alloc(16);
        header.writeUIntLE(12,0,3);
        header[3] = 1;
        header.writeUInt32LE(1,5);
        connection.stream.write(header);
      }
      connection._resetSequenceId();
    });
    connection.on('stmt_execute',(_id,_flags,_iteration,values) => {
      writes++;
      const [value,key,exactKey,previous] = values;
      const matches = key === id && exactKey === id && previous === stored;
      if (matches) pending = value;
      connection.writeOk({affectedRows:matches ? 1 : 0,warningCount:value === 'Would truncate' ? 1 : 0});
      connection._resetSequenceId();
    });
  });
  const app = createStudio();
  try {
    await new Promise((resolve,reject)=>mysqlServer.once('error',reject).listen(0,'127.0.0.1',resolve));
    await new Promise((resolve,reject)=>app.once('error',reject).listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:' + app.address().port;
    const connection = {host:'127.0.0.1',port:mysqlServer._server.address().port,user:'reader',password:'test-password',database:'sample',tls:false};
    async function call(values,status = 200) {
      const response = await fetch(origin+'/api/vue',{method:'POST',
        headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'database',connection,...values})});
      const result = await response.json();
      assert.equal(response.status,status,JSON.stringify(result));
      return result;
    }
    assert.deepEqual(await call({}),{tables:[table,'unkeyed']});
    const preview = await call({table});
    assert.deepEqual(preview.columns,['id','name']);
    assert.deepEqual(preview.rows[0],['9223372036854775807',null]);
    assert.equal(preview.rows.length,50);
    assert.equal(preview.hasMore,true);
    assert.deepEqual(preview.primaryKey,['id']);
    assert.deepEqual(preview.rowKeys[0],[id]);
    assert.deepEqual(preview.columnDetails.map(({editable})=>editable),[false,true]);
    const update = {column:'name',key:[id],previous:null,value:"O'Reilly \\ sample"};
    assert.deepEqual(await call({table,update}),{saved:true});
    assert.equal(stored,update.value);
    await call({table,update:{...update,value:'Stale'}},409);
    await call({table,update:{...update,previous:stored,value:'Would truncate'}},422);
    assert.equal(stored,update.value);
    await call({table,update:{...update,column:'id'}},400);
    await call({table:'unkeyed',update},400);
    assert.equal(writes,3);
    await call({table:'other'},404);
    await call({connection:{...connection,port:65536}},400);
    const denied = await call({connection:{...connection,user:'other'}},422);
    assert.doesNotMatch(denied.error,/Private server details|test-password/);
    assert.deepEqual(serverErrors,[]);
  } finally {
    await app.closeWorkspace();
    if (app.listening) await new Promise(resolve=>app.close(resolve));
    for (const connection of connections) connection.destroy();
    mysqlServer.close();
  }
});
