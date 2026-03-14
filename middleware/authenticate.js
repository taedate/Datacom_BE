import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'DaranWeb';

function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && typeof authHeader === 'string') {
        if (authHeader.startsWith('Bearer ')) {
            return authHeader.split(' ')[1];
        }
        return authHeader;
    }

    const altHeaders = [
        req.headers['x-access-token'],
        req.headers['access-token'],
        req.headers.token,
    ];

    for (const headerValue of altHeaders) {
        if (typeof headerValue === 'string' && headerValue.trim()) {
            return headerValue.trim();
        }
    }

    return null;
}

/**
 * Middleware: verify Bearer JWT, attach decoded payload to req.user
 */
export function authenticate(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ message: 'error', code: 'FORBIDDEN', detail: 'No token provided' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ message: 'error', code: 'FORBIDDEN', detail: 'Invalid token payload' });
        }
        next();
    } catch {
        return res.status(401).json({ message: 'error', code: 'FORBIDDEN', detail: 'Invalid or expired token' });
    }
}

/**
 * Middleware factory: require one of the allowed roles
 */
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'error', code: 'FORBIDDEN', detail: 'Authentication is required' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'error', code: 'FORBIDDEN', detail: 'Insufficient permissions' });
        }
        next();
    };
}

/**
 * Middleware: best-effort JWT parse for audit attribution.
 * If token is valid, req.user will be attached; otherwise request continues.
 */
export function optionalAuthenticate(req, _res, next) {
    const token = extractToken(req);
    if (!token) {
        console.log(`[AUDIT-DEBUG] ${req.method} ${req.originalUrl || req.url} → NO TOKEN found in headers`);
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.userId) {
            req.user = decoded;
            console.log(`[AUDIT-DEBUG] ${req.method} ${req.originalUrl || req.url} → userId=${decoded.userId} (${decoded.userName})`);
        }
    } catch (err) {
        console.log(`[AUDIT-DEBUG] ${req.method} ${req.originalUrl || req.url} → token INVALID: ${err.message}`);
    }

    return next();
}
