CREATE TABLE IF NOT EXISTS shared_note_author_colors (
  user_id INT NOT NULL PRIMARY KEY,
  color_hex CHAR(7) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
