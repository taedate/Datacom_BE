import crypto from 'crypto';

export function requestContext(req, res, next) {
    const incomingRequestId = req.headers['x-request-id'];
    req.requestId = (typeof incomingRequestId === 'string' && incomingRequestId.trim())
        ? incomingRequestId.trim()
        : crypto.randomUUID();

    req.clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
        .toString()
        .split(',')[0]
        .trim() || null;

    req.userAgent = req.headers['user-agent'] || null;

    res.setHeader('x-request-id', req.requestId);
    next();
}
