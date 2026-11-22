# Datacom_BE

## Shared floating notes

Run `node db/run_shared_notes_migration.js` before starting the backend with this feature. The idempotent migration creates the notes, attachment metadata and file-cleanup tables and preserves existing records.

Authenticated users share `GET/POST /shared-notes` and `PUT/DELETE /shared-notes/:id`. Updates and deletions require `expected_version` from the latest note; concurrent changes return HTTP 409 and preserve the current note. Author and editor identities come from the signed session. The floating client refreshes every 10 seconds and when returning to the tab; its badge counts all current notes. Creating, editing and deleting notes are included in the audit history.

Each author receives a persistent color in `shared_note_author_colors`, with a unique constraint preventing duplicate colors. Rerunning the migration assigns colors to existing note authors. The client retains unread indicators per browser/account until the user opens the notes, highlights incoming notes, and edits notes directly in their cards. Switching editors only prompts to discard when text or attachment selection has actually changed.

Attachments use multipart `attachments` (up to 5 files, 10 MiB each, 25 MiB combined per note), with `body`, `expected_version` for updates, and JSON `keep_attachment_ids`. Omitting the latter preserves existing attachments for older clients. Notes can contain files without text. Originals are streamed to private `storage/shared-notes`, outside the public uploads directory; authenticated download endpoints verify the note and attachment IDs. Supported images get a cached WebP thumbnail bounded to 480 pixels, processed sequentially. File bytes never appear in the polling response, and unchanged polls use ETags/HTTP 304. The browser fetches thumbnails only on demand and releases image URLs when closed.

Removing an attachment or note commits a durable deletion request with the metadata change, then waits for physical removal of both the original and thumbnail. A minute-by-minute cleanup job retries interrupted deletions. Upload leases and expired temporary-file cleanup remove abandoned files without deleting attachments belonging to a committed note. Keep `storage/shared-notes` on persistent local storage and include it alongside the database in backups.

## Optional item group name

Before deploying the item group name feature, run `node db/run_item_group_name_migration.js` from this directory. The migration only adds the nullable `documents.item_group_name` column and can be run again safely; it does not rename or backfill existing documents or sections.

The quotation API accepts an optional `item_group_name` (up to 255 characters). Omitting it during an update preserves its saved value; sending an empty string or `null` clears it and restores the existing automatic naming behavior.

## LINE Chatbot (Integrated)

This project now includes LINE webhook chatbot endpoints in the same Node/Express app.

### Endpoints

- `POST /callback` for LINE Messaging API webhook
- `GET /imagemap/help/:size` for imagemap image resizing (`size` supports: `1040, 700, 460, 300, 240`)

### Required environment variables

- `CHANNEL_ACCESS_TOKEN` or `LINE_CHANNEL_ACCESS_TOKEN`
- `CHANNEL_SECRET` or `LINE_CHANNEL_SECRET`
- `LINE_IMAGEMAP_BASE_URL` (optional, defaults to `https://datacom-chatbot.onrender.com/imagemap/help`)

### Required static asset

- Put `help_menu.png` at `static/help_menu.png`

### Notes

- Current chatbot session state uses in-memory `Map` (will reset on server restart).
- Daily digest push job remains active via `service/lineDigestJob.js`.
