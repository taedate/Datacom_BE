import { createHash } from 'node:crypto';
import database from '../service/database.js';
import { makeAuditSnapshot } from '../service/auditEntityService.js';
import { createSharedNoteFiles, isAttachmentId, NOTE_MAX_FILES, NOTE_MAX_TOTAL_BYTES } from '../service/sharedNoteFiles.js';
import { ensureNoteAuthorColor } from '../service/sharedNoteColors.js';

const files = createSharedNoteFiles({ database });
const columns = 'id, body, created_by, created_by_name, updated_by, updated_by_name, version, created_at, updated_at';
const attachmentColumns = 'id, note_id, original_name, mime_type, size_bytes, has_thumbnail';
const validId = value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const validBody = body => typeof body === 'string' && body.length <= 5000;
const actor = req => [req.user.userId, (req.user.userName || `ผู้ใช้ #${req.user.userId}`).slice(0, 255)];
const snapshot = (row, attachments) => makeAuditSnapshot('shared_note', {
    ...row, attachment_count: attachments.length, attachment_ids: attachments.map(file => file.id).sort(),
});

function keepIds(req) {
    const value = req.body?.keep_attachment_ids;
    if (value === undefined) return undefined;
    const ids = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(ids) || ids.length > NOTE_MAX_FILES || ids.some(id => !isAttachmentId(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid attachment selection');
    return ids;
}

export async function getSharedNotes(req, res) {
    try {
        const [rows] = await database.query(`SELECT ${columns.split(', ').map(column => `n.${column}`).join(', ')}, c.color_hex AS author_color
            FROM shared_notes n LEFT JOIN shared_note_author_colors c ON c.user_id = n.created_by ORDER BY n.id DESC`);
        const etag = `"${createHash('sha256').update(rows.map(row => `${row.id}:${row.version}:${row.author_color || ''}`).join(',')).digest('hex')}"`;
        res.set('Cache-Control', 'no-store');
        res.set('ETag', etag);
        if (req.headers?.['if-none-match'] === etag) return res.status(304).end();
        // Metadata only: never read image/file bytes during polling.
        const [attachments] = rows.length ? await database.query(`SELECT ${attachmentColumns} FROM shared_note_attachments ORDER BY note_id, id`) : [[]];
        const grouped = new Map();
        for (const file of attachments) {
            if (!grouped.has(file.note_id)) grouped.set(file.note_id, []);
            grouped.get(file.note_id).push(file);
        }
        res.json({ message: 'success', data: rows.map(row => ({ ...row, attachments: grouped.get(row.id) || [] })), total: rows.length });
    } catch (error) {
        console.error('Read shared notes failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'โหลดโน้ตไม่สำเร็จ กรุณาลองใหม่' });
    }
}

export async function createSharedNote(req, res) {
    const uploads = req.files || [];
    if (!validBody(req.body?.body) || (!req.body.body.trim() && !uploads.length)) {
        return res.status(400).json({ message: 'error', detail: 'กรุณาเพิ่มข้อความหรือไฟล์แนบ และกรอกข้อความไม่เกิน 5,000 ตัวอักษร' });
    }
    let connection, committed = false;
    try {
        const prepared = uploads.length ? await files.prepareUploads(uploads) : [];
        connection = await database.pool.getConnection();
        await connection.beginTransaction();
        const [userId, userName] = actor(req);
        await ensureNoteAuthorColor(connection, userId);
        const [result] = await connection.query(`INSERT INTO shared_notes
            (body, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [req.body.body.trim(), userId, userName, userId, userName]);
        await files.saveMetadata(connection, result.insertId, prepared);
        await connection.commit(); committed = true; connection.release(); connection = null;
        res.locals.auditSnapshots = { after: snapshot({ id: result.insertId, body: req.body.body.trim(), created_by_name: userName }, prepared) };
        res.status(201).json({ message: 'success', id: result.insertId });
    } catch (error) {
        if (connection && !committed) await connection.rollback().catch(() => {});
        console.error('Create shared note failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'เพิ่มโน้ตไม่สำเร็จ กรุณาลองใหม่' });
    } finally {
        connection?.release();
        if (!committed && uploads.length) await files.discardUploads(uploads);
    }
}

async function mutateNote(req, res, remove) {
    const id = Number(req.params.id);
    const rawVersion = req.body?.expected_version;
    const version = typeof rawVersion === 'string' && /^[1-9]\d*$/.test(rawVersion) ? Number(rawVersion) : rawVersion;
    let retainedIds;
    try { if (!remove) retainedIds = keepIds(req); } catch { retainedIds = null; }
    if (!validId(req.params.id) || !Number.isSafeInteger(version) || version < 1
        || (!remove && (!validBody(req.body?.body) || retainedIds === null))) {
        return res.status(400).json({ message: 'error', detail: 'ข้อมูลโน้ตไม่ถูกต้อง กรุณาโหลดรายการล่าสุดแล้วลองใหม่' });
    }
    const uploads = req.files || [];
    let connection, committed = false;
    try {
        const prepared = uploads.length ? await files.prepareUploads(uploads) : [];
        connection = await database.pool.getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query(`SELECT ${columns} FROM shared_notes WHERE id = ? FOR UPDATE`, [id]);
        const [existing] = rows.length ? await connection.query(`SELECT ${attachmentColumns} FROM shared_note_attachments WHERE note_id = ?`, [id]) : [[]];
        if (!rows.length || rows[0].version !== version) {
            await connection.rollback();
            return res.status(rows.length ? 409 : 404).json({ message: 'error', detail: rows.length ? 'มีผู้แก้ไขโน้ตนี้แล้ว กรุณาตรวจสอบข้อความล่าสุด' : 'โน้ตนี้ถูกลบไปแล้ว', data: rows[0] ? { ...rows[0], attachments: existing } : null });
        }
        const kept = remove ? [] : retainedIds === undefined ? existing : existing.filter(file => retainedIds.includes(file.id));
        const finalAttachments = [...kept, ...prepared];
        if (!remove && ((retainedIds && kept.length !== retainedIds.length) || finalAttachments.length > NOTE_MAX_FILES
            || finalAttachments.reduce((sum, file) => sum + file.size_bytes, 0) > NOTE_MAX_TOTAL_BYTES
            || (!req.body.body.trim() && !finalAttachments.length))) {
            await connection.rollback();
            return res.status(400).json({ message: 'error', detail: 'โน้ตต้องมีข้อความหรือไฟล์แนบ แนบได้ไม่เกิน 5 ไฟล์ รวมไม่เกิน 25 MB' });
        }
        const removed = existing.filter(file => !kept.some(retained => retained.id === file.id));
        const before = snapshot(rows[0], existing);
        await files.enqueueDeletion(connection, removed);
        let after = null;
        if (remove) {
            await connection.query('DELETE FROM shared_notes WHERE id = ?', [id]);
        } else {
            for (const file of removed) await connection.query('DELETE FROM shared_note_attachments WHERE id = ? AND note_id = ?', [file.id, id]);
            await files.saveMetadata(connection, id, prepared);
            const [userId, userName] = actor(req);
            await connection.query(`UPDATE shared_notes SET body = ?, updated_by = ?, updated_by_name = ?,
                version = version + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [req.body.body.trim(), userId, userName, id]);
            after = snapshot({ ...rows[0], body: req.body.body.trim() }, finalAttachments);
        }
        await connection.commit(); committed = true; connection.release(); connection = null;
        let cleanupDone = true;
        if (removed.length) {
            try { cleanupDone = await files.purgeQueued(removed.map(file => file.id)); }
            catch (error) { cleanupDone = false; console.error('Shared-note deletion queued for retry:', error.code || error.message); }
        }
        res.locals.auditSnapshots = { before, after };
        res.json({ message: 'success', id, ...(!cleanupDone && { file_cleanup_pending: true }) });
    } catch (error) {
        if (connection && !committed) await connection.rollback().catch(() => {});
        console.error('Change shared note failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ กรุณาลองใหม่' });
    } finally {
        connection?.release();
        if (!committed && uploads.length) await files.discardUploads(uploads);
    }
}

export async function getSharedNoteAttachment(req, res) {
    if (!validId(req.params.id) || !isAttachmentId(req.params.attachmentId)) return res.status(404).json({ message: 'error', detail: 'ไม่พบไฟล์แนบ' });
    try {
        const [rows] = await database.query(`SELECT ${attachmentColumns} FROM shared_note_attachments WHERE id = ? AND note_id = ?`, [req.params.attachmentId, Number(req.params.id)]);
        const thumbnail = req.params.variant === 'thumbnail';
        if (!rows.length || (thumbnail && !rows[0].has_thumbnail)) return res.status(404).json({ message: 'error', detail: 'ไฟล์นี้ถูกลบหรือไม่พบภาพย่อ' });
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': thumbnail ? 'image/webp' : 'application/octet-stream' };
        const complete = error => {
            if (error && !res.headersSent) res.status(error.code === 'ENOENT' ? 404 : 500).json({ message: 'error', detail: 'เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่' });
            else if (error) res.destroy();
        };
        if (thumbnail) res.sendFile(files.filePath(rows[0].id, true), { headers }, complete);
        else res.download(files.filePath(rows[0].id), rows[0].original_name, { headers }, complete);
    } catch (error) {
        console.error('Read shared-note attachment failed:', error.code || error.message);
        res.status(500).json({ message: 'error', detail: 'โหลดไฟล์แนบไม่สำเร็จ' });
    }
}

export const updateSharedNote = (req, res) => mutateNote(req, res, false);
export const deleteSharedNote = (req, res) => mutateNote(req, res, true);
