import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as records from '../service/repairRecord.js';

const original={caseId:'PC-100',cusFirstName:'ลูกค้า',cusLastName:'',cusPhone:'0812345678',caseInstitution:'หน่วยงาน',brokenSymptom:'เปิดไม่ติด',caseType:'ซ่อมคอมพิวเตอร์',caseStatus:'รับเครื่องแล้ว',caseBrand:'ยี่ห้อ',caseModel:'รุ่น',caseSN:'SN-1',caseEquipment:'เครื่องพร้อมสาย',caseDurableArticles:'',repairDetails:JSON.stringify([{description:'ตรวจเครื่อง',cost:0,price:100}]),repairCost:'0.00',repairPrice:'100.00',datePickUp:'21-11-2569',dateBeforePicUp:null,dateComplete:null,dateDelivered:null,staffName:'ผู้รับ',refSentRepairId:null,updated_at:new Date('2026-11-21T03:00:00Z')};
async function setup(){
 const state={rows:[structuredClone(original)],queries:[],commits:0,rollbacks:0,releases:0,failWrite:false,lockAvailable:true};let before;
 const connection={async beginTransaction(){before=structuredClone(state.rows);},async commit(){state.commits++;},async rollback(){if(before)state.rows=structuredClone(before);state.rollbacks++;},release(){state.releases++;},async query(sql,params=[]){
  const text=sql.replace(/\s+/g,' ').trim();state.queries.push({sql:text,params:structuredClone(params)});
  if(text.includes('GET_LOCK'))return [[{acquired:state.lockAvailable?1:0}]];
  if(text.includes('RELEASE_LOCK'))return [[{released:1}]];
  if(text.startsWith('SELECT caseId FROM caseRepair WHERE caseId REGEXP'))return [[...state.rows].filter(row=>new RegExp(params[0]).test(row.caseId)).sort((a,b)=>Number(b.caseId.split('-')[1])-Number(a.caseId.split('-')[1])).slice(0,1)];
  if(text.startsWith('SELECT * FROM caseRepair'))return [structuredClone(state.rows.filter(row=>row.caseId===params[0]))];
  if(state.failWrite)throw new Error('write failed');
  if(text.startsWith('INSERT INTO caseRepair')){
   const fields=text.match(/caseRepair \(([^)]+)\)/)[1].split(',').map(value=>value.trim());let index=0;const row={updated_at:new Date(original.updated_at)};
   for(const field of fields)row[field]=field==='created_at'||field==='updated_at'||field.startsWith('statusDate')?new Date(original.updated_at):params[index++];
   assert.equal(index,params.length);assert.equal(state.rows.some(item=>item.caseId===row.caseId),false);state.rows.push(row);return [{affectedRows:1}];
  }
  if(text.startsWith('UPDATE caseRepair SET')){
   const row=state.rows.find(row=>row.caseId===params.at(-1));const fields=[...text.matchAll(/(\w+)=\?/g)].map(match=>match[1]);
   assert.equal(fields.at(-1),'caseId');for(let i=0;i<fields.length-1;i++)row[fields[i]]=params[i];
   row.updated_at=new Date(original.updated_at);return [{affectedRows:1}];
  }
  throw new Error('Unexpected query '+text);
 }};
 const context=vm.createContext({console:{error(){}},Buffer});
 const db=new vm.SyntheticModule(['default'],function(){this.setExport('default',{query:connection.query,pool:{async getConnection(){return connection;}}});},{context});
 const recordModule=new vm.SyntheticModule(Object.keys(records),function(){for(const [key,value]of Object.entries(records))this.setExport(key,value);},{context});
 const audit=new vm.SyntheticModule(['makeAuditSnapshot'],function(){this.setExport('makeAuditSnapshot',(_type,row)=>row?structuredClone(row):null);},{context});
 const module=new vm.SourceTextModule(await readFile(new URL('../controller/repairController.js',import.meta.url),'utf8'),{context});await module.link(specifier=>specifier.includes('database')?db:specifier.includes('repairRecord')?recordModule:audit);await module.evaluate();
 async function call(name,body={},params={}){const res={statusCode:200,locals:{},headers:{},set(name,value){this.headers[name]=value;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};await module.namespace[name]({body,params},res);return res;}
 return {state,call};
}

test('loading repair details returns the persisted items and a revision without modifying the record',async()=>{
 const {call,state}=await setup();const res=await call('getCaseDetail',{}, {id:'PC-100'});
 assert.equal(res.statusCode,200);assert.equal(res.body.data.repairItems[0].cost,0);assert.equal(res.body.revision,records.repairRevision(state.rows[0]));assert.equal(res.headers['Cache-Control'],'no-store');
});
test('legacy zero timestamps cannot prevent loading or printing a saved case',async()=>{
 const {call,state}=await setup();state.rows[0].updated_at=new Date(NaN);
 assert.equal((await call('getCaseDetail',{}, {id:'PC-100'})).statusCode,200);
 assert.equal((await call('prepareCasePrint',{caseId:'PC-100'})).statusCode,200);
});
test('updating a missing case cannot report a successful save',async()=>{
 const {call,state}=await setup();const res=await call('updateCase',{caseId:'PC-MISSING',cusFirstName:'หาย'});
 assert.equal(res.statusCode,404);assert.equal(state.queries.some(query=>query.sql.startsWith('UPDATE')),false);assert.deepEqual(state.rows,[original]);
});
test('partial updates preserve existing repair details, device data and prices',async()=>{
 const {call,state}=await setup();const res=await call('updateCase',{caseId:'PC-100',cusFirstName:'แก้ชื่อ',expected_revision:records.repairRevision(state.rows[0])});
 assert.equal(res.statusCode,200);assert.equal(state.rows[0].cusFirstName,'แก้ชื่อ');assert.equal(state.rows[0].repairDetails,original.repairDetails);assert.equal(state.rows[0].caseSN,'SN-1');assert.equal(state.rows[0].repairPrice,100);assert.equal(state.rows[0].repairCost,0);assert.equal(res.body.data.caseId,'PC-100');assert.equal(state.commits,1);
});
test('same-second edits from another user are rejected without overwriting data',async()=>{
 const {call,state}=await setup();const stale=records.repairRevision(state.rows[0]);state.rows[0].repairDetails='ผู้ใช้อื่นบันทึกแล้ว';
 const res=await call('updateCase',{caseId:'PC-100',expected_revision:stale,repairDetails:'ข้อมูลเก่า'});
 assert.equal(res.statusCode,409);assert.equal(state.rows[0].repairDetails,'ผู้ใช้อื่นบันทึกแล้ว');assert.equal(state.queries.some(query=>query.sql.startsWith('UPDATE')),false);
});
test('failed database writes roll back and preserve the previous record',async()=>{
 const {call,state}=await setup();state.failWrite=true;const res=await call('updateCase',{caseId:'PC-100',cusFirstName:'แก้ชื่อ'});assert.equal(res.statusCode,500);assert.deepEqual(state.rows,[original]);assert.equal(state.rollbacks,1);
});
test('new cases receive distinct IDs under the creation lock and never replace existing records',async()=>{
 const {call,state}=await setup();const body={...original,caseId:undefined};delete body.updated_at;
 const first=await call('createCase',body),second=await call('createCase',body);assert.equal(first.body.caseId,'PC-101');assert.equal(second.body.caseId,'PC-102');assert.deepEqual(state.rows[0],original);assert.equal(state.queries.filter(query=>query.sql.includes('GET_LOCK')).length,2);assert.equal(state.queries.filter(query=>query.sql.includes('RELEASE_LOCK')).length,2);assert.equal(first.body.data.cusLastName,'');
});
test('printing reads only confirmed persisted data and cannot delete or update a repair',async()=>{
 const {call,state}=await setup();const before=structuredClone(state.rows);const res=await call('prepareCasePrint',{caseId:'PC-100',expected_revision:records.repairRevision(state.rows[0])});
 assert.equal(res.statusCode,200);assert.equal(res.body.data.repairItems[0].description,'ตรวจเครื่อง');assert.deepEqual(state.rows,before);assert.ok(state.queries.every(query=>query.sql.startsWith('SELECT')));
});
test('printing missing or stale records is blocked before producing a printable response',async()=>{
 const {call,state}=await setup();assert.equal((await call('prepareCasePrint',{caseId:'missing'})).statusCode,404);
 assert.equal((await call('prepareCasePrint',{caseId:'PC-100',expected_revision:'old'})).statusCode,409);assert.deepEqual(state.rows,[original]);
});
test('invalid or oversized inputs cannot silently truncate saved data',async()=>{
 const {call,state}=await setup();for(const change of [{cusFirstName:''},{repairItems:'invalid'},{brokenSymptom:'x'.repeat(256)},{repairDetails:'ก'.repeat(22000)}])assert.equal((await call('updateCase',{caseId:'PC-100',...change})).statusCode,400);
 assert.deepEqual(state.rows,[original]);
});
