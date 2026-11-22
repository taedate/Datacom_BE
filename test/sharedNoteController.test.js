import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/authenticate.js';
import { createSharedNotesTable } from '../db/run_shared_notes_migration.js';
import * as crypto from 'node:crypto';
import * as fileLibrary from '../service/sharedNoteFiles.js';

async function setup() {
    const records = new Map(), attachments = new Map(), queries = [], purged = [], discarded = [];
    let nextId = 1, commits = 0, rollbacks = 0, releases = 0;
    const connection = {
        async beginTransaction() {}, async commit() { commits++; },
        async rollback() { rollbacks++; }, release() { releases++; },
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (sql.includes('SELECT') && sql.includes('shared_note_attachments')) return [[...attachments.values()].filter(file => sql.includes('WHERE id') ? file.id === params[0] && (params.length < 2 || file.note_id === params[1]) : !sql.includes('WHERE note_id') || file.note_id === params[0])];
            if (sql.includes('INSERT INTO shared_notes')) {
                const [body, created_by, created_by_name, updated_by, updated_by_name] = params;
                records.set(nextId, { id: nextId, body, created_by, created_by_name, updated_by, updated_by_name, version: 1 });
                return [{ insertId: nextId++ }];
            }
            if (sql.includes('SELECT')) return [[...records.values()].filter(row => !sql.includes('WHERE id') || row.id === params[0]).map(row => ({ ...row })).reverse()];
            if (sql.startsWith('UPDATE')) {
                const row = records.get(params[3]);
                Object.assign(row, { body: params[0], updated_by: params[1], updated_by_name: params[2], version: row.version + 1 });
            }
            if (sql.startsWith('DELETE FROM shared_note_attachments')) attachments.delete(params[0]);
            else if (sql.startsWith('DELETE')) { records.delete(params[0]); for (const [key,file] of attachments) if(file.note_id === params[0])attachments.delete(key); }
            return [{ affectedRows: 1 }];
        },
    };
    const context = vm.createContext({ console });
    const db = new vm.SyntheticModule(['default'], function () { this.setExport('default', { query: connection.query, pool: { async getConnection() { return connection; } } }); }, { context });
    const audit = new vm.SyntheticModule(['makeAuditSnapshot'], function () { this.setExport('makeAuditSnapshot', (type, row) => ({ entityType: type, entityId: row.id, fields: { body: row.body } })); }, { context });
    const fileModule = new vm.SyntheticModule(Object.keys(fileLibrary), function () {
        for (const [key,value] of Object.entries(fileLibrary)) this.setExport(key,key === 'createSharedNoteFiles' ? () => ({
            async prepareUploads(uploads) { return uploads.map(file => ({id:file.filename,original_name:file.originalname,size_bytes:file.size,has_thumbnail:0})); },
            async saveMetadata(_connection,noteId,files) { for(const file of files) attachments.set(file.id,{...file,note_id:noteId}); },
            async enqueueDeletion() {}, async purgeQueued(ids) { purged.push(...ids); return true; },
            async discardUploads(files) { discarded.push(...files.map(file => file.filename)); },
            filePath(id,thumbnail) { return `/private/test/${id}${thumbnail ? '.thumb.webp' : ''}`; },
        }) : value);
    }, {context});
    const cryptoModule = new vm.SyntheticModule(Object.keys(crypto),function(){for(const [key,value] of Object.entries(crypto))this.setExport(key,value);},{context});
    const colorsModule = new vm.SyntheticModule(['ensureNoteAuthorColor'],function(){this.setExport('ensureNoteAuthorColor',async()=> '#6D4AE5');},{context});
    const module = new vm.SourceTextModule(await readFile(new URL('../controller/sharedNoteController.js', import.meta.url), 'utf8'), { context });
    await module.link(specifier => specifier.includes('database') ? db : specifier.includes('sharedNoteColors') ? colorsModule : specifier.includes('sharedNoteFiles') ? fileModule : specifier === 'node:crypto' ? cryptoModule : audit);
    await module.evaluate();
    async function call(name, body = {}, id, user = { userId: 7, userName: 'ผู้จด' }, extra = {}) {
        const res = response();
        await module.namespace[name]({ body, params: { id: String(id) }, user, ...extra }, res);
        return res;
    }
    return { call, records, attachments, queries, purged, discarded, stats: () => ({ commits, rollbacks, releases }) };
}

function response() {
    return { statusCode: 200, locals: {}, headers: {}, status(code) { this.statusCode = code; return this; }, set(name, value) { this.headers[name] = value; return this; }, json(body) { this.body = body; return this; },end(){return this;},download(path,name,options){this.file={path,name,options};},sendFile(path,options){this.file={path,options};} };
}

test('shared notes require a valid signed session', () => {
    for (const authorization of [undefined, 'Bearer invalid']) {
        const res = response(); let next = false;
        authenticate({ headers: { authorization } }, res, () => { next = true; });
        assert.equal(res.statusCode, 401); assert.equal(next, false);
    }
    const req = { headers: { authorization: `Bearer ${jwt.sign({ userId: 7, userName: 'ผู้จด' }, process.env.JWT_SECRET || 'DaranWeb')}` } };
    let next = false;
    authenticate(req, response(), () => { next = true; });
    assert.equal(next, true); assert.equal(req.user.userId, 7);
});

test('migration only creates the shared notes table and is safe to run again', async () => {
    const queries = [];
    await createSharedNotesTable({ async query(sql) { queries.push(sql); return [[]]; } });
    assert.equal(queries.length, 5);
    assert.match(queries[0], /^CREATE TABLE IF NOT EXISTS shared_notes/);
    for(const sql of queries.slice(0,4))assert.match(sql.trim(),/^CREATE TABLE IF NOT EXISTS/);
});

test('multiple notes persist with authenticated authors; submitted identities are ignored', async () => {
    const { call } = await setup();
    const one = await call('createSharedNote', { body: '  ฝากติดต่อลูกค้า\nช่วงบ่าย  ', created_by: 999, created_by_name: 'ปลอม' });
    const two = await call('createSharedNote', { body: 'งานอีกชิ้น' }, undefined, { userId: 8, userName: 'ผู้จดคนที่สอง' });
    assert.equal(one.statusCode, 201); assert.equal(two.statusCode, 201);
    const result = await call('getSharedNotes');
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(result.body.total, 2);
    assert.equal(result.body.data[0].created_by_name, 'ผู้จดคนที่สอง');
    assert.equal(result.body.data[1].created_by, 7);
    assert.equal(result.body.data[1].body, 'ฝากติดต่อลูกค้า\nช่วงบ่าย');
});

test('blank, oversized and non-text notes are rejected before any write', async () => {
    const { call, queries } = await setup();
    for (const body of ['', '  \n ', 'x'.repeat(5001), null, {}, 123]) {
        assert.equal((await call('createSharedNote', { body })).statusCode, 400);
    }
    assert.equal(queries.length, 0);
});

test('another user can edit a note, preserving its author and recording the editor', async () => {
    const { call, records, stats } = await setup();
    await call('createSharedNote', { body: 'ข้อความเดิม' });
    const edited = await call('updateSharedNote', { body: 'ข้อความใหม่', expected_version: 1 }, 1, { userId: 8, userName: 'ผู้แก้ไข' });
    assert.equal(edited.statusCode, 200);
    assert.equal(records.get(1).created_by, 7); assert.equal(records.get(1).updated_by, 8);
    assert.equal(records.get(1).version, 2);
    assert.equal(edited.locals.auditSnapshots.before.fields.body, 'ข้อความเดิม');
    assert.equal(edited.locals.auditSnapshots.after.fields.body, 'ข้อความใหม่');
    assert.deepEqual(stats(), { commits: 2, rollbacks: 0, releases: 2 });
});

test('a stale edit or delete cannot overwrite another user’s changes', async () => {
    const { call, records } = await setup();
    await call('createSharedNote', { body: 'เดิม' });
    await call('updateSharedNote', { body: 'แก้แล้ว', expected_version: 1 }, 1);
    for (const method of ['updateSharedNote', 'deleteSharedNote']) {
        const result = await call(method, { body: 'ข้อมูลเก่า', expected_version: 1 }, 1);
        assert.equal(result.statusCode, 409);
        assert.equal(result.body.data.body, 'แก้แล้ว');
        assert.equal(records.get(1).body, 'แก้แล้ว');
    }
});

test('deleting a note updates the count and a second delete reports it is gone', async () => {
    const { call } = await setup();
    await call('createSharedNote', { body: 'ลบได้' });
    assert.equal((await call('deleteSharedNote', { expected_version: 1 }, 1)).statusCode, 200);
    assert.equal((await call('getSharedNotes')).body.total, 0);
    assert.equal((await call('deleteSharedNote', { expected_version: 1 }, 1)).statusCode, 404);
});

test('missing version and invalid identifiers cannot change notes', async () => {
    const { call, queries } = await setup();
    for (const id of ['0', '-1', '1 OR 1', '2.5', '9007199254740992']) {
        assert.equal((await call('deleteSharedNote', { expected_version: 1 }, id)).statusCode, 400);
    }
    assert.equal((await call('updateSharedNote', { body: 'ข้อความ' }, 1)).statusCode, 400);
    assert.equal(queries.length, 0);
});

const fileA = '11111111-1111-4111-8111-111111111111';
const fileB = '22222222-2222-4222-8222-222222222222';
const upload = id => ({filename:id,originalname:'รูปแนบ.png',size:1234,mimetype:'image/png'});

test('file-only notes return lightweight metadata; unchanged polls skip attachment queries',async()=>{
    const {call,queries}=await setup();
    assert.equal((await call('createSharedNote',{body:''},undefined,undefined,{files:[upload(fileA)]})).statusCode,201);
    const listed=await call('getSharedNotes');
    assert.equal(listed.body.data[0].attachments[0].id,fileA);
    assert.equal(listed.body.data[0].attachments[0].size_bytes,1234);
    const queryCount=queries.length;
    const unchanged=await call('getSharedNotes',{},undefined,undefined,{headers:{'if-none-match':listed.headers.ETag}});
    assert.equal(unchanged.statusCode,304);assert.equal(queries.length,queryCount+1);
});

test('replacing attachments deletes removed files and retains others for legacy clients',async()=>{
    const {call,attachments,purged}=await setup();
    await call('createSharedNote',{body:'โน้ต'},undefined,undefined,{files:[upload(fileA)]});
    await call('updateSharedNote',{body:'เก็บไฟล์เดิม',expected_version:1},1);
    assert.ok(attachments.has(fileA));assert.equal(purged.length,0);
    const replaced=await call('updateSharedNote',{body:'เปลี่ยนรูป',expected_version:'2',keep_attachment_ids:'[]'},1,undefined,{files:[upload(fileB)]});
    assert.equal(replaced.statusCode,200);assert.deepEqual(purged,[fileA]);
    assert.equal(attachments.has(fileA),false);assert.equal(attachments.has(fileB),true);
    await call('deleteSharedNote',{expected_version:3},1);
    assert.deepEqual(purged,[fileA,fileB]);assert.equal(attachments.size,0);
});

test('stale uploads are discarded without removing the existing attachment',async()=>{
    const {call,attachments,discarded,purged}=await setup();
    await call('createSharedNote',{body:'โน้ต'},undefined,undefined,{files:[upload(fileA)]});
    const stale=await call('updateSharedNote',{body:'เก่า',expected_version:2,keep_attachment_ids:[]},1,undefined,{files:[upload(fileB)]});
    assert.equal(stale.statusCode,409);assert.equal(stale.body.data.attachments[0].id,fileA);
    assert.deepEqual(discarded,[fileB]);assert.ok(attachments.has(fileA));assert.equal(purged.length,0);
});

test('an attachment belonging to another note cannot be adopted or downloaded through this note',async()=>{
    const {call}=await setup();
    await call('createSharedNote',{body:'หนึ่ง'},undefined,undefined,{files:[upload(fileA)]});
    await call('createSharedNote',{body:'สอง'});
    assert.equal((await call('updateSharedNote',{body:'สอง',expected_version:1,keep_attachment_ids:[fileA]},2)).statusCode,400);
    assert.equal((await call('getSharedNoteAttachment',{},undefined,undefined,{params:{id:'2',attachmentId:fileA}})).statusCode,404);
    const valid=await call('getSharedNoteAttachment',{},undefined,undefined,{params:{id:'1',attachmentId:fileA}});
    assert.equal(valid.file.name,'รูปแนบ.png');
    assert.equal(valid.file.options.headers['Content-Type'],'application/octet-stream');
    assert.equal((await call('getSharedNoteAttachment',{},undefined,undefined,{params:{id:'1',attachmentId:'../../.env'}})).statusCode,404);
});
