import { mkdir, rename, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const NOTE_FILE_ROOT = fileURLToPath(new URL('../storage/shared-notes/', import.meta.url));
export const NOTE_MAX_FILES = 5;
export const NOTE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const NOTE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const isAttachmentId = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

let activeThumbnails = 0;
const thumbnailWaiters = [];
async function withThumbnailSlot(work) {
    if (activeThumbnails >= 2) await new Promise(resolve => thumbnailWaiters.push(resolve));
    else activeThumbnails++;
    try { return await work(); }
    finally {
        const next = thumbnailWaiters.shift();
        if (next) next();
        else activeThumbnails--;
    }
}

export function cleanAttachmentName(value) {
    let name = String(value || 'file');
    if ([...name].every(char => char.codePointAt(0) <= 255)) {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        if (!decoded.includes('\uFFFD')) name = decoded;
    }
    name = name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, '').trim();
    return !name || name === '.' || name === '..' ? 'file' : [...name].slice(0, 255).join('');
}

export function createSharedNoteFiles({ database, root = NOTE_FILE_ROOT }) {
    function filePath(id, thumbnail = false, incoming = false) {
        if (!isAttachmentId(id)) throw new Error('Invalid attachment ID');
        return path.join(root, incoming ? '.incoming' : '', id + (thumbnail ? '.thumb.webp' : ''));
    }
    async function removeFiles(id) {
        for (const incoming of [false, true]) for (const thumbnail of [false, true]) {
            await unlink(filePath(id, thumbnail, incoming)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
    }
    async function discardUploads(uploads) {
        for (const upload of uploads) {
            const id = upload.id || upload.filename;
            if (!isAttachmentId(id)) continue;
            try {
                // A lost COMMIT response must never delete files that were committed.
                const [references] = await database.query('SELECT id FROM shared_note_attachments WHERE id = ?', [id]);
                if (references.length) continue;
                await removeFiles(id);
                await database.query('DELETE FROM shared_note_file_cleanup WHERE attachment_id = ?', [id]);
            } catch (error) {
                console.error('Deferred shared-note upload cleanup:', error.code || error.message);
            }
        }
    }
    async function prepareUploads(uploads) {
        await mkdir(root, { recursive: true });
        const prepared = [];
        // Process images sequentially; never keep all originals in memory.
        for (const upload of uploads) {
            const id = upload.filename;
            if (!isAttachmentId(id)) throw new Error('Invalid upload ID');
            // Durable lease covers a crash between publishing a file and COMMIT.
            await database.query(`INSERT INTO shared_note_file_cleanup (attachment_id, available_at)
                VALUES (?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)`, [id]);
            await rename(filePath(id, false, true), filePath(id));
            let hasThumbnail = false;
            if (upload.mimetype?.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|tiff?|heic|heif)$/i.test(upload.originalname)) {
                try {
                    await withThumbnailSlot(() => sharp(filePath(id), { limitInputPixels: 25000000, animated: false })
                        .rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 70 }).timeout({ seconds: 5 }).toFile(filePath(id, true)));
                    hasThumbnail = true;
                } catch {
                    // Unsupported images remain downloadable; no original is loaded as a preview.
                    await unlink(filePath(id, true)).catch(error => { if (error.code !== 'ENOENT') throw error; });
                }
            }
            prepared.push({ id, original_name: cleanAttachmentName(upload.originalname), mime_type: upload.mimetype || 'application/octet-stream', size_bytes: upload.size, has_thumbnail: hasThumbnail ? 1 : 0 });
        }
        return prepared;
    }
    async function saveMetadata(connection, noteId, uploads) {
        for (const file of uploads) {
            await connection.query(`INSERT INTO shared_note_attachments
                (id, note_id, original_name, mime_type, size_bytes, has_thumbnail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
            [file.id, noteId, file.original_name, file.mime_type, file.size_bytes, file.has_thumbnail]);
            await connection.query('DELETE FROM shared_note_file_cleanup WHERE attachment_id = ?', [file.id]);
        }
    }
    async function enqueueDeletion(connection, attachments) {
        for (const file of attachments) await connection.query(`INSERT INTO shared_note_file_cleanup (attachment_id, available_at)
            VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE available_at = UTC_TIMESTAMP()`, [file.id]);
    }
    async function purgeQueued(ids) {
        const [rows] = await database.query(`SELECT q.attachment_id FROM shared_note_file_cleanup q
            LEFT JOIN shared_note_attachments a ON a.id = q.attachment_id
            WHERE a.id IS NULL AND q.available_at <= UTC_TIMESTAMP()
            ${ids?.length ? 'AND q.attachment_id IN (?)' : ''} ORDER BY q.available_at LIMIT 50`, ids?.length ? [ids] : []);
        let pending = false;
        for (const row of rows) {
            try {
                await removeFiles(row.attachment_id);
                await database.query('DELETE FROM shared_note_file_cleanup WHERE attachment_id = ?', [row.attachment_id]);
            } catch (error) {
                pending = true;
                console.error('Deferred shared-note file deletion:', error.code || error.message);
            }
        }
        return !pending;
    }
    async function cleanupIncoming() {
        const incoming = path.join(root, '.incoming');
        const names = await readdir(incoming).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names) {
            if (!isAttachmentId(name)) continue;
            const file = path.join(incoming, name);
            const info = await stat(file).catch(() => null);
            if (info && Date.now() - info.mtimeMs > 3600000) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
    }
    return { filePath, prepareUploads, saveMetadata, enqueueDeletion, purgeQueued, discardUploads, cleanupIncoming };
}
