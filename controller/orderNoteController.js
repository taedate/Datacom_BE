import database from '../service/database.js';

export async function getNotes(req, res) {
    try {
        const [rows] = await database.query('SELECT * FROM order_notes ORDER BY created_at DESC');
        res.json({ message: 'success', data: rows });
    } catch (error) {
        console.error('Error fetching order notes:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function createNote(req, res) {
    try {
        const { department, body, quotation_id } = req.body;
        if (!department || !body) {
            return res.status(400).json({ error: 'Department and body are required' });
        }

        if (quotation_id) {
            const [existing] = await database.query(
                'SELECT id FROM order_notes WHERE quotation_id = ?',
                [quotation_id]
            );
            if (existing.length > 0) {
                await database.query(
                    'UPDATE order_notes SET department = ?, body = ? WHERE quotation_id = ?',
                    [department, body, quotation_id]
                );
                return res.json({ message: 'success', id: existing[0].id, updated: true });
            }
        }
        
        const [result] = await database.query(
            'INSERT INTO order_notes (department, body, quotation_id) VALUES (?, ?, ?)',
            [department, body, quotation_id || null]
        );
        
        res.status(201).json({ message: 'success', id: result.insertId });
    } catch (error) {
        console.error('Error creating order note:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function deleteNote(req, res) {
    try {
        const { id } = req.params;
        
        // Find the linked quotation ID if it exists
        const [notes] = await database.query('SELECT quotation_id FROM order_notes WHERE id = ?', [id]);
        if (notes.length === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }
        
        const linkedQuotationId = notes[0].quotation_id;
        
        // Delete the note
        await database.query('DELETE FROM order_notes WHERE id = ?', [id]);
        
        // If there was a linked quotation, set its status to 'ITEMS_READY'
        if (linkedQuotationId) {
            await database.query(
                "UPDATE documents SET current_status = 'ITEMS_READY' WHERE id = ?",
                [linkedQuotationId]
            );
        }
        
        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error deleting order note:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

export async function updateNote(req, res) {
    try {
        const { id } = req.params;
        const { body } = req.body;
        
        if (!body) {
            return res.status(400).json({ error: 'Body is required' });
        }

        const [result] = await database.query(
            'UPDATE order_notes SET body = ? WHERE id = ?',
            [body, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error updating order note:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
