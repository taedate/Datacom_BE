import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,access,rm,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createSharedNoteFiles,cleanAttachmentName} from '../service/sharedNoteFiles.js';

const id='11111111-1111-4111-8111-111111111111';
async function setup(t){
    const root=await mkdtemp(path.join(os.tmpdir(),'note-files-'));await mkdir(path.join(root,'.incoming'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const queued=new Map(),references=new Set();
    const database={async query(sql,params=[]){
        if(sql.startsWith('INSERT INTO shared_note_file_cleanup'))queued.set(params[0],sql.includes('1 HOUR')?'later':'now');
        else if(sql.startsWith('DELETE FROM shared_note_file_cleanup'))queued.delete(params[0]);
        else if(sql.startsWith('SELECT id FROM shared_note_attachments'))return [references.has(params[0])?[{id:params[0]}]:[]];
        else if(sql.startsWith('SELECT q.attachment_id'))return [[...queued].filter(([key,when])=>when==='now'&&!references.has(key)&&(!params.length||params[0].includes(key))).map(([attachment_id])=>({attachment_id}))];
        else if(sql.startsWith('INSERT INTO shared_note_attachments'))references.add(params[0]);
        else throw new Error('Unexpected SQL: '+sql);
        return [{affectedRows:1}];
    }};
    return {root,queued,references,database,files:createSharedNoteFiles({database,root})};
}

test('images keep their original bytes and create a bounded WebP thumbnail; deletion removes both',async t=>{
    const {files,queued,database}=await setup(t);
    const original=await sharp({create:{width:1800,height:1200,channels:3,background:'#7251be'}}).png().toBuffer();
    await writeFile(files.filePath(id,false,true),original);
    const prepared=await files.prepareUploads([{filename:id,originalname:'รูป.png',mimetype:'image/png',size:original.length}]);
    assert.deepEqual(await readFile(files.filePath(id)),original);
    const thumbnail=await sharp(files.filePath(id,true)).metadata();
    assert.equal(thumbnail.format,'webp');assert.ok(thumbnail.width<=480&&thumbnail.height<=480);
    assert.equal(prepared[0].has_thumbnail,1);
    await files.enqueueDeletion(database,prepared);await files.purgeQueued([id]);
    await assert.rejects(access(files.filePath(id)),{code:'ENOENT'});await assert.rejects(access(files.filePath(id,true)),{code:'ENOENT'});
    assert.equal(queued.size,0);
});

test('failed uploads are removed while an uncertain commit never deletes referenced files',async t=>{
    const {files,references}=await setup(t);
    await writeFile(files.filePath(id,false,true),'document');
    const prepared=await files.prepareUploads([{filename:id,originalname:'test.pdf',mimetype:'application/pdf',size:8}]);
    assert.equal(prepared[0].has_thumbnail,0);
    references.add(id);await files.discardUploads(prepared);assert.equal((await readFile(files.filePath(id))).toString(),'document');
    references.delete(id);await files.discardUploads(prepared);await assert.rejects(access(files.filePath(id)),{code:'ENOENT'});
});

test('crash cleanup retries durable deletion requests and ignores files still attached to notes',async t=>{
    const {files,queued,references}=await setup(t);
    await writeFile(files.filePath(id),'file');queued.set(id,'now');references.add(id);
    await files.purgeQueued();assert.equal(queued.size,1);await access(files.filePath(id));
    references.delete(id);await files.purgeQueued();assert.equal(queued.size,0);await assert.rejects(access(files.filePath(id)),{code:'ENOENT'});
});

test('abandoned temporary uploads are removed without touching active uploads',async t=>{
    const {files}=await setup(t);
    const file=files.filePath(id,false,true);await writeFile(file,'temporary');
    await files.cleanupIncoming();await access(file);
    await utimes(file,new Date(Date.now()-7200000),new Date(Date.now()-7200000));
    await files.cleanupIncoming();await assert.rejects(access(file),{code:'ENOENT'});
});

test('filenames retain Thai text and cannot select filesystem paths',async t=>{
    const {files}=await setup(t);
    assert.equal(cleanAttachmentName(Buffer.from('ใบส่งของ.pdf').toString('latin1')),'ใบส่งของ.pdf');
    assert.equal(cleanAttachmentName('../../file\n.pdf'),'file.pdf');
    assert.throws(()=>files.filePath('../../.env'));
});
