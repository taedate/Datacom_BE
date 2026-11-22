import database from './database.js';
import { createSharedNoteFiles } from './sharedNoteFiles.js';

export function startSharedNoteFileCleanupJob() {
    const files = createSharedNoteFiles({ database });
    let running = false;
    const clean = async () => {
        if (running) return;
        running = true;
        try { await files.purgeQueued(); await files.cleanupIncoming(); }
        catch (error) { console.error('Shared-note cleanup will retry:', error.code || error.message); }
        finally { running = false; }
    };
    clean();
    const timer = setInterval(clean, 60000);
    timer.unref();
    return timer;
}
