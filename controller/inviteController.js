import * as inviteService from '../service/inviteService.js';

// ------------------------------------------------------------------ helpers

function codedError(res, status, code, detail) {
    return res.status(status).json({ message: 'error', code, detail });
}

function requireAuthenticatedUser(req, res) {
    if (req.user?.userId) {
        return req.user;
    }
    codedError(res, 401, 'FORBIDDEN', 'Authentication is required');
    return null;
}

const KNOWN_CODES = {
    INVITE_NOT_FOUND:       404,
    INVITE_EXPIRED:         410,
    INVITE_ALREADY_USED:    409,
    INVITE_REVOKED:         410,
    USERNAME_ALREADY_EXISTS:409,
    PASSWORD_POLICY_FAILED: 422,
    FORBIDDEN:              403,
};

function handleServiceError(res, err) {
    const status = KNOWN_CODES[err.code] || 500;
    return codedError(res, status, err.code || 'INTERNAL_ERROR', err.message);
}

// ------------------------------------------------------------------ POST /invites

export async function createInvite(req, res) {
    const { invitedUserName, role, expireMinutes } = req.body;
    const user = requireAuthenticatedUser(req, res);

    if (!user) {
        return;
    }

    if (!invitedUserName || !role) {
        return codedError(res, 400, 'VALIDATION_ERROR', 'invitedUserName and role are required');
    }
    if (!['admin', 'manager', 'user'].includes(role)) {
        return codedError(res, 400, 'VALIDATION_ERROR', 'role must be admin | manager | user');
    }
    const minutes = Number(expireMinutes) || 1440; // default 24 h
    if (minutes < 1 || minutes > 43200) { // max 30 days
        return codedError(res, 400, 'VALIDATION_ERROR', 'expireMinutes must be between 1 and 43200');
    }

    try {
        const result = await inviteService.createInvite({
            invitedUserName,
            role,
            expireMinutes: minutes,
            invitedByUserId: user.userId,
        });
        return res.status(201).json({
            message: 'success',
            payload: result,
        });
    } catch (err) {
        return handleServiceError(res, err);
    }
}

// ------------------------------------------------------------------ GET /invites/validate?token=

export async function validateInvite(req, res) {
    const { token } = req.query;
    if (!token) {
        return codedError(res, 400, 'VALIDATION_ERROR', 'token query parameter is required');
    }
    try {
        const payload = await inviteService.validateInviteToken(token);
        return res.json({ message: 'success', payload });
    } catch (err) {
        return handleServiceError(res, err);
    }
}

// ------------------------------------------------------------------ POST /register-by-invite

export async function registerByInvite(req, res) {
    const { token, password } = req.body;
    if (!token || !password) {
        return codedError(res, 400, 'VALIDATION_ERROR', 'token and password are required');
    }
    try {
        const user = await inviteService.registerByInvite({
            plainToken: token,
            password,
        });
        return res.status(201).json({
            message: 'success',
            payload: { userId: user.userId, userName: user.userName, role: user.role },
        });
    } catch (err) {
        return handleServiceError(res, err);
    }
}

// ------------------------------------------------------------------ POST /invites/:id/revoke

export async function revokeInvite(req, res) {
    const inviteId = parseInt(req.params.id, 10);
    const user = requireAuthenticatedUser(req, res);

    if (!user) {
        return;
    }

    if (!inviteId) {
        return codedError(res, 400, 'VALIDATION_ERROR', 'Invalid invite id');
    }
    try {
        await inviteService.revokeInvite({
            inviteId,
        });
        return res.json({ message: 'success', payload: { inviteId } });
    } catch (err) {
        return handleServiceError(res, err);
    }
}

// ------------------------------------------------------------------ GET /invites

export async function listInvites(req, res) {
    try {
        const invites = await inviteService.listInvites();
        return res.json({ message: 'success', payload: invites });
    } catch (err) {
        return handleServiceError(res, err);
    }
}
