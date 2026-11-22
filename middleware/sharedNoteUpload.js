import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { NOTE_FILE_ROOT, NOTE_MAX_FILES, NOTE_MAX_FILE_BYTES, NOTE_MAX_TOTAL_BYTES } from '../service/sharedNoteFiles.js';

const incoming = path.join(NOTE_FILE_ROOT, '.incoming');
const upload = multer({
    storage: multer.diskStorage({
        destination(_req, _file, done) { mkdir(incoming, { recursive: true }).then(() => done(null, incoming), done); },
        filename(_req, _file, done) { done(null, randomUUID()); },
    }),
    limits: { fileSize: NOTE_MAX_FILE_BYTES, files: NOTE_MAX_FILES, fields: 4, fieldSize: 24000, parts: 10 },
}).array('attachments', NOTE_MAX_FILES);

export function sharedNoteUpload(req, res, next) {
    upload(req, res, async error => {
        const cleanup = () => Promise.all((req.files || []).map(file => unlink(file.path).catch(() => {})));
        if (error || (req.files || []).reduce((total, file) => total + file.size, 0) > NOTE_MAX_TOTAL_BYTES) {
            await cleanup();
            return res.status(400).json({ message: 'error', detail: error?.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์แต่ละไฟล์ต้องไม่เกิน 10 MB' : 'แนบได้ไม่เกิน 5 ไฟล์ รวมไม่เกิน 25 MB กรุณาตรวจสอบไฟล์แล้วลองใหม่' });
        }
        res.once('finish', cleanup);
        res.once('close', cleanup);
        next();
    });
}
