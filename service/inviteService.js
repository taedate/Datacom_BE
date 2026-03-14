import crypto from 'crypto';
import bcrypt from 'bcrypt';
import database from './database.js';

const BCRYPT_ROUNDS = 12;

// ------------------------------------------------------------------ helpers

function hashToken(plainToken) {
    return crypto.createHash('sha256').update(plainToken).digest('hex');
}

function maskUserName(name) {
    if (!name || name.length <= 3) return '***';
    return name.slice(0, 2) + '***' + name.slice(-1);
}

function createCodedError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

async function markInviteExpired(conn, inviteId) {
    const executor = conn || database;
    await executor.query(
        `UPDATE invites
         SET status = 'expired', updatedAt = NOW()
         WHERE inviteId = ? AND status = 'pending'`,
        [inviteId]
    );
}

async function assertInviteUsable(invite, conn = null) {
    if (invite.status === 'used') {
        throw createCodedError('INVITE_ALREADY_USED', 'Invite already used');
    }
    if (invite.status === 'revoked') {
        throw createCodedError('INVITE_REVOKED', 'Invite revoked');
    }
    if (invite.status === 'expired' || new Date(invite.expiresAt) < new Date()) {
        await markInviteExpired(conn, invite.inviteId);
        throw createCodedError('INVITE_EXPIRED', 'Invite link expired');
    }
}

// ------------------------------------------------------------------ services

/**
 * Create a new invite link.
 * Returns { inviteUrl, inviteId, expiresAt }
 */
export async function createInvite({ invitedUserName, role, expireMinutes, invitedByUserId }) {
    const plainToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash   = hashToken(plainToken);
    const expiresAt   = new Date(Date.now() + expireMinutes * 60 * 1000);

    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        const [result] = await conn.query(
            `INSERT INTO invites (invitedUserName, role, tokenHash, expiresAt, status, invitedBy)
             VALUES (?, ?, ?, ?, 'pending', ?)`,
            [invitedUserName, role, tokenHash, expiresAt, invitedByUserId]
        );
        const inviteId = result.insertId;

        await conn.commit();

        const baseUrl  = process.env.FRONTEND_URL || 'http://localhost:5173';
        const inviteUrl = `${baseUrl}/register?token=${plainToken}`;

        return { inviteId, inviteUrl, expiresAt };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Validate a plain token.
 * Returns the invite row (with masked userName) or throws a coded error.
 */
export async function validateInviteToken(plainToken) {
    const tokenHash = hashToken(plainToken);

    const [rows] = await database.query(
        `SELECT inviteId, invitedUserName, role, expiresAt, usedAt, status
         FROM invites
         WHERE tokenHash = ?`,
        [tokenHash]
    );

    if (rows.length === 0) {
        throw createCodedError('INVITE_NOT_FOUND', 'Invite not found');
    }

    const invite = rows[0];

    await assertInviteUsable(invite);

    return {
        inviteId: invite.inviteId,
        invitedUserName: invite.invitedUserName,
        role: invite.role,
        expiresAt: invite.expiresAt,
        status: invite.status,
        invitedUserNameMask: maskUserName(invite.invitedUserName),
    };
}

/**
 * Register a new user through a valid invite (transactional).
 * Returns { userId, userName, role }
 */
export async function registerByInvite({ plainToken, password }) {
    // Password policy: min 8 chars, at least 1 uppercase, 1 digit
    if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        throw createCodedError(
            'PASSWORD_POLICY_FAILED',
            'Password must be at least 8 characters and contain an uppercase letter and a digit'
        );
    }

    const tokenHash = hashToken(plainToken);

    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        // Re-fetch invite inside the transaction (with row lock)
        const [rows] = await conn.query(
            `SELECT inviteId, invitedUserName, role, expiresAt, status
             FROM invites
             WHERE tokenHash = ?
             FOR UPDATE`,
            [tokenHash]
        );

        if (rows.length === 0) {
            throw createCodedError('INVITE_NOT_FOUND', 'Invite not found');
        }
        const invite = rows[0];

        await assertInviteUsable(invite, conn);

        // Check username uniqueness
        const [existing] = await conn.query(
            'SELECT userId FROM users WHERE userName = ?',
            [invite.invitedUserName]
        );
        if (existing.length > 0) {
            throw createCodedError('USERNAME_ALREADY_EXISTS', 'Username already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Create user
        const [userResult] = await conn.query(
            `INSERT INTO users (userName, userPassword, role, isActive)
             VALUES (?, ?, ?, 1)`,
            [invite.invitedUserName, passwordHash, invite.role]
        );
        const userId = userResult.insertId;

        // Mark invite as used
        await conn.query(
            `UPDATE invites
             SET status = 'used', usedAt = NOW(), updatedAt = NOW()
             WHERE inviteId = ?`,
            [invite.inviteId]
        );

        await conn.commit();

        return { userId, userName: invite.invitedUserName, role: invite.role };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Revoke an invite (admin action).
 */
export async function revokeInvite({ inviteId }) {
    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT inviteId, status FROM invites WHERE inviteId = ? FOR UPDATE',
            [inviteId]
        );
        if (rows.length === 0) {
            throw createCodedError('INVITE_NOT_FOUND', 'Invite not found');
        }
        if (rows[0].status === 'used') {
            throw createCodedError('INVITE_ALREADY_USED', 'Invite already used');
        }

        await conn.query(
            `UPDATE invites SET status = 'revoked', updatedAt = NOW() WHERE inviteId = ?`,
            [inviteId]
        );

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * List all invites (admin).
 * Never returns tokenHash.
 */
export async function listInvites() {
    const [rows] = await database.query(
        `SELECT i.inviteId, i.invitedUserName, i.role, i.expiresAt,
                i.usedAt, i.status, i.createdAt, i.updatedAt,
                u.userName AS invitedByName
         FROM invites i
         LEFT JOIN users u ON u.userId = i.invitedBy
         ORDER BY i.createdAt DESC`,
        []
    );
    return rows;
}
