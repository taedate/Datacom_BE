const palette = ['#6D4AE5', '#047F75', '#C05222', '#2563EB', '#BE185D', '#52800D', '#A16207', '#0891B2', '#9333B8', '#576577', '#B3282B', '#316C48'];

function extraColor(index) {
    const hue = (index * 137.507764) % 360;
    const saturation = 0.62, lightness = 0.38;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const channel = n => {
        const k = (n + hue / 30) % 12;
        return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

export async function ensureNoteAuthorColor(connection, userId) {
    const [existing] = await connection.query('SELECT color_hex FROM shared_note_author_colors WHERE user_id = ?', [userId]);
    if (existing.length) return existing[0].color_hex;
    const [assigned] = await connection.query('SELECT color_hex FROM shared_note_author_colors');
    const taken = new Set(assigned.map(row => row.color_hex.toUpperCase()));
    for (let index = 0; index < 4096; index++) {
        const color = index < palette.length ? palette[index] : extraColor(index - palette.length);
        if (taken.has(color)) continue;
        await connection.query('INSERT IGNORE INTO shared_note_author_colors (user_id, color_hex) VALUES (?, ?)', [userId, color]);
        // UNIQUE(color_hex) also handles two users posting their first note concurrently.
        const [saved] = await connection.query('SELECT color_hex FROM shared_note_author_colors WHERE user_id = ? FOR UPDATE', [userId]);
        if (saved.length) return saved[0].color_hex;
        taken.add(color);
    }
    throw new Error('Unable to allocate a unique note author color');
}
