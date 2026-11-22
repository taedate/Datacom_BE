import assert from 'node:assert/strict';
import test from 'node:test';
import {ensureNoteAuthorColor} from '../service/sharedNoteColors.js';

test('authors keep a distinct persistent color, including concurrent allocation collisions',async()=>{
    const colors=new Map();let collideOnce=true;
    const connection={async query(sql,params=[]){
        if(sql.startsWith('SELECT'))return [[...colors].filter(([id])=>!sql.includes('WHERE')||id===params[0]).map(([,color_hex])=>({color_hex}))];
        const [id,color]=params;
        if(collideOnce){colors.set(99,color);collideOnce=false;}
        if(!colors.has(id)&&![...colors.values()].includes(color))colors.set(id,color);
        return [{affectedRows:1}];
    }};
    const first=await ensureNoteAuthorColor(connection,7);
    for(let id=8;id<36;id++)await ensureNoteAuthorColor(connection,id);
    assert.equal(new Set(colors.values()).size,colors.size);
    assert.equal(await ensureNoteAuthorColor(connection,7),first);
    assert.notEqual(first,colors.get(99));
    for(const color of colors.values())assert.match(color,/^#[0-9A-F]{6}$/);
});
