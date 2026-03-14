-- ============================================================
-- Invite-based Registration Migration
-- Run this script once against your database.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Alter existing `users` table to add required columns
--    (Skip any ALTER if the column already exists in your DB)
-- ------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role        VARCHAR(50)  NOT NULL DEFAULT 'user'             COMMENT 'admin | manager | user',
  ADD COLUMN IF NOT EXISTS isActive    TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS createdAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updatedAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lastLoginAt DATETIME     NULL;

-- Ensure userName is unique (skip if already unique/PK)
SET @has_users_username_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'uq_users_userName'
);
SET @sql := IF(
  @has_users_username_index = 0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_userName (userName)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2. Create `invites` table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invites (
  inviteId        INT           NOT NULL AUTO_INCREMENT,
  invitedUserName VARCHAR(100)  NOT NULL                    COMMENT 'username or email reserved for this invite',
  role            VARCHAR(50)   NOT NULL DEFAULT 'user',
  tokenHash       CHAR(64)      NOT NULL                    COMMENT 'SHA-256 hex of the one-time token',
  expiresAt       DATETIME      NOT NULL,
  usedAt          DATETIME      NULL,
  status          ENUM('pending','used','revoked','expired') NOT NULL DEFAULT 'pending',
  invitedBy       INT           NOT NULL                    COMMENT 'FK -> users.userId (admin who created)',
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (inviteId),
  UNIQUE  KEY uq_invites_tokenHash (tokenHash),
  INDEX   idx_invites_status_expires (status, expiresAt),
  CONSTRAINT fk_invites_invitedBy FOREIGN KEY (invitedBy) REFERENCES users (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS invitedUserName VARCHAR(100) NOT NULL COMMENT 'username or email reserved for this invite' AFTER inviteId,
  ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user' AFTER invitedUserName,
  ADD COLUMN IF NOT EXISTS tokenHash CHAR(64) NOT NULL COMMENT 'SHA-256 hex of the one-time token' AFTER role,
  ADD COLUMN IF NOT EXISTS expiresAt DATETIME NOT NULL AFTER tokenHash,
  ADD COLUMN IF NOT EXISTS usedAt DATETIME NULL AFTER expiresAt,
  ADD COLUMN IF NOT EXISTS status ENUM('pending','used','revoked','expired') NOT NULL DEFAULT 'pending' AFTER usedAt,
  ADD COLUMN IF NOT EXISTS invitedBy INT NOT NULL COMMENT 'FK -> users.userId (admin who created)' AFTER status,
  ADD COLUMN IF NOT EXISTS createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER invitedBy,
  ADD COLUMN IF NOT EXISTS updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER createdAt;

SET @has_invites_tokenhash_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invites'
    AND INDEX_NAME = 'uq_invites_tokenHash'
);
SET @sql := IF(
  @has_invites_tokenhash_index = 0,
  'ALTER TABLE invites ADD UNIQUE KEY uq_invites_tokenHash (tokenHash)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_invites_status_expires_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invites'
    AND INDEX_NAME = 'idx_invites_status_expires'
);
SET @sql := IF(
  @has_invites_status_expires_index = 0,
  'ALTER TABLE invites ADD INDEX idx_invites_status_expires (status, expiresAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 3. Create `audit_logs` table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  logId        BIGINT        NOT NULL AUTO_INCREMENT,
  performedBy INT           NULL       COMMENT 'userId (NULL = anonymous)',
  action      VARCHAR(100)  NOT NULL,
  module      VARCHAR(50)   NOT NULL,
  entityType  VARCHAR(100)  NOT NULL   COMMENT 'invite, user, project, etc.',
  entityId    VARCHAR(100)  NULL       COMMENT 'inviteId, userId, etc.',
  status      VARCHAR(20)   NOT NULL,
  severity    VARCHAR(20)   NOT NULL,
  detail      JSON          NULL,
  ipAddress   VARCHAR(45)   NULL,
  userAgent   TEXT          NULL,
  requestId   VARCHAR(64)   NULL,
  createdAt   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (logId),
  INDEX idx_audit_created_at (createdAt),
  INDEX idx_audit_performed_by_created_at (performedBy, createdAt),
  INDEX idx_audit_status_created_at (status, createdAt),
  INDEX idx_audit_action_created_at (action, createdAt),
  INDEX idx_audit_action (action),
  INDEX idx_audit_module_created_at (module, createdAt),
  INDEX idx_audit_request_id (requestId),
  INDEX idx_audit_entity    (entityType, entityId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. Align existing `audit_logs` tables with the current schema
--    Standardize on performedBy + entityType/entityId.
-- ------------------------------------------------------------

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS performedBy INT NULL COMMENT 'userId (NULL = anonymous)' AFTER action,
  ADD COLUMN IF NOT EXISTS entityType VARCHAR(100) NOT NULL DEFAULT 'invite' COMMENT 'invite, user, project, etc.' AFTER performedBy,
  ADD COLUMN IF NOT EXISTS entityId VARCHAR(100) NULL COMMENT 'inviteId, userId, etc.' AFTER entityType,
  ADD COLUMN IF NOT EXISTS module VARCHAR(50) NOT NULL DEFAULT 'system' AFTER action,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'fail' AFTER entityId,
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'error' AFTER status,
  ADD COLUMN IF NOT EXISTS detail JSON NULL AFTER severity,
  ADD COLUMN IF NOT EXISTS requestId VARCHAR(64) NULL AFTER userAgent,
  ADD COLUMN IF NOT EXISTS ip VARCHAR(45) NULL AFTER entityId,
  ADD COLUMN IF NOT EXISTS ipAddress VARCHAR(45) NULL AFTER ip,
  ADD COLUMN IF NOT EXISTS userAgent TEXT NULL AFTER ip,
  ADD COLUMN IF NOT EXISTS meta JSON NULL COMMENT 'extra structured data (no passwords/tokens)' AFTER userAgent,
  ADD COLUMN IF NOT EXISTS createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER meta;

SET @has_target_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'targetId'
);
SET @sql := IF(
  @has_target_id > 0,
  'UPDATE audit_logs SET entityId = targetId WHERE entityId IS NULL AND targetId IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_actor_user_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'actorUserId'
);
SET @sql := IF(
  @has_actor_user_id > 0,
  'UPDATE audit_logs SET performedBy = actorUserId WHERE performedBy IS NULL AND actorUserId IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ip_address := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'ipAddress'
);
SET @sql := IF(
  @has_ip_address > 0,
  'UPDATE audit_logs SET ip = ipAddress WHERE ip IS NULL AND ipAddress IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_detail := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'detail'
);
SET @sql := IF(
  @has_detail > 0,
  'UPDATE audit_logs SET meta = JSON_OBJECT(\'detail\', detail) WHERE meta IS NULL AND detail IS NOT NULL AND detail <> \'\'',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_module := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'module'
);
SET @sql := IF(
  @has_module > 0,
  'UPDATE audit_logs SET module = \'system\' WHERE module IS NULL OR module = \'\'',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'status'
);
SET @sql := IF(
  @has_status > 0,
  'UPDATE audit_logs SET status = \'success\' WHERE status IS NULL OR status = \'\'',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_severity := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'severity'
);
SET @sql := IF(
  @has_severity > 0,
  'UPDATE audit_logs SET severity = \'info\' WHERE severity IS NULL OR severity = \'\'',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_detail_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'detail'
);
SET @has_meta_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'meta'
);
SET @sql := IF(
  @has_detail_json > 0 AND @has_meta_json > 0,
  'UPDATE audit_logs SET detail = meta WHERE detail IS NULL AND meta IS NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE audit_logs
SET entityType = 'invite'
WHERE entityType IS NULL OR entityType = '';

SET @has_entity_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_entity'
);
SET @sql := IF(
  @has_entity_index = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_entity (entityType, entityId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_created_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_created_at'
);
SET @sql := IF(
  @has_created_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_created_at (createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_performed_created_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_performed_by_created_at'
);
SET @sql := IF(
  @has_performed_created_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_performed_by_created_at (performedBy, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_action_created_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_action_created_at'
);
SET @sql := IF(
  @has_action_created_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_action_created_at (action, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_status_created_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_status_created_at'
);
SET @sql := IF(
  @has_status_created_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_status_created_at (status, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_action_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_action'
);
SET @sql := IF(
  @has_action_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_action (action)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_request_id_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_request_id'
);
SET @sql := IF(
  @has_request_id_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_request_id (requestId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_module_created_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_logs'
    AND INDEX_NAME = 'idx_audit_module_created_at'
);
SET @sql := IF(
  @has_module_created_idx = 0,
  'ALTER TABLE audit_logs ADD INDEX idx_audit_module_created_at (module, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
