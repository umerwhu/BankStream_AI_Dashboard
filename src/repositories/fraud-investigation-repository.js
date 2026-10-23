import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const file=path.join(env.stateDir,'fraud-investigations.json');
const poolPromise=env.databaseUrl?import('pg').then(({Pool})=>new Pool({connectionString:env.databaseUrl,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined})):null;
async function read(){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function write(items){await mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`,data=JSON.stringify(items,null,2);await writeFile(tmp,data,{mode:0o600});try{await rename(tmp,file);}catch(error){if(!['EPERM','EEXIST','ENOTEMPTY'].includes(error.code))throw error;await writeFile(file,data,{mode:0o600});await unlink(tmp).catch(()=>{});}}
export const fraudInvestigationRepository={
  async list(){if(poolPromise){const {rows}=await(await poolPromise).query('SELECT payload FROM fraud_investigations ORDER BY updated_at DESC');return rows.map(x=>x.payload);}return read();},
  async update(alert,changes,actor){
    const now=new Date().toISOString();
    if(poolPromise){const pool=await poolPromise,client=await pool.connect();await client.query('BEGIN');try{
      const found=await client.query('SELECT payload FROM fraud_investigations WHERE alert_id=$1 FOR UPDATE',[alert.alertId]);
      const prior=found.rows[0]?.payload||{alertId:alert.alertId,customerIds:alert.customerIds,status:'NEW',assignedTo:null,decisionNote:null,createdAt:now,audit:[]};
      const nextStatus=changes.status||prior.status;
      if(changes.assignedTo!==undefined)prior.assignedTo=changes.assignedTo;
      if(changes.decisionNote!==undefined)prior.decisionNote=changes.decisionNote;
      prior.status=nextStatus;prior.updatedAt=now;
      const event={status:nextStatus,assignedTo:prior.assignedTo,decisionNote:changes.decisionNote||null,changedAt:now,actor};prior.audit.push(event);
      await client.query('INSERT INTO fraud_investigations (alert_id,customer_ids,status,assigned_to,created_at,updated_at,payload) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7) ON CONFLICT(alert_id) DO UPDATE SET customer_ids=EXCLUDED.customer_ids,status=EXCLUDED.status,assigned_to=EXCLUDED.assigned_to,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload',[alert.alertId,JSON.stringify(alert.customerIds),nextStatus,prior.assignedTo,prior.createdAt,now,prior]);
      await client.query('INSERT INTO fraud_investigation_audit (alert_id,status,assigned_to,decision_note,actor,changed_at) VALUES ($1,$2,$3,$4,$5,$6)',[alert.alertId,nextStatus,prior.assignedTo,event.decisionNote,actor,now]);await client.query('COMMIT');return prior;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    const items=await read();let prior=items.find(x=>x.alertId===alert.alertId);if(!prior){prior={alertId:alert.alertId,customerIds:alert.customerIds,status:'NEW',assignedTo:null,decisionNote:null,createdAt:now,audit:[]};items.push(prior);}if(changes.assignedTo!==undefined)prior.assignedTo=changes.assignedTo;if(changes.decisionNote!==undefined)prior.decisionNote=changes.decisionNote;prior.status=changes.status||prior.status;prior.updatedAt=now;prior.audit.push({status:prior.status,assignedTo:prior.assignedTo,decisionNote:changes.decisionNote||null,changedAt:now,actor});await write(items);return prior;
  }
};
