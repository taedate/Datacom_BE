const store = new Map();

function set(key, value, ttlSeconds = 60) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    store.set(key, { value, expiresAt });
}

function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

function del(key) {
    store.delete(key);
}

export default { get, set, del };
