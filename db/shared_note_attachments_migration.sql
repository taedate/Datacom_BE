CREATE TABLE IF NOT EXISTS shared_note_attachments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  note_id INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  has_thumbnail TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX idx_note_attachments (note_id),
  CONSTRAINT fk_shared_note_attachment FOREIGN KEY (note_id) REFERENCES shared_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shared_note_file_cleanup (
  attachment_id CHAR(36) NOT NULL PRIMARY KEY,
  available_at DATETIME NOT NULL,
  INDEX idx_shared_note_cleanup (available_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
