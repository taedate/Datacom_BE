import database from '../service/database.js';

export const getTemplates = async (req, res) => {
    try {
        const [templates] = await database.query(`
            SELECT t.*, COUNT(ti.id) as item_count 
            FROM quotation_templates t 
            LEFT JOIN quotation_template_items ti ON t.id = ti.template_id 
            GROUP BY t.id 
            ORDER BY t.name ASC
        `);
        res.json(templates);
    } catch (error) {
        console.error("Error fetching templates:", error);
        res.status(500).json({ error: error.message });
    }
};

export const getTemplateById = async (req, res) => {
    const { id } = req.params;
    try {
        const [templates] = await database.query('SELECT * FROM quotation_templates WHERE id = ?', [id]);
        if (templates.length === 0) return res.status(404).json({ error: "Not found" });
        
        const template = templates[0];
        const [items] = await database.query('SELECT * FROM quotation_template_items WHERE template_id = ? ORDER BY sort_order ASC', [id]);
        
        // Map database columns to frontend camelCase
        template.items = items.map(item => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unit_price,
            is_sub_item: item.is_sub_item === 1
        }));
        res.json(template);
    } catch (error) {
        console.error("Error fetching template:", error);
        res.status(500).json({ error: error.message });
    }
};

export const createTemplate = async (req, res) => {
    const { name, items } = req.body;
    try {
        const [result] = await database.query('INSERT INTO quotation_templates (name) VALUES (?)', [name]);
        const templateId = result.insertId;
        
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await database.query(
                    'INSERT INTO quotation_template_items (template_id, description, quantity, unit, unit_price, is_sub_item, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [templateId, item.description || '', item.quantity || 1, item.unit || '', item.unitPrice === "" ? null : item.unitPrice, item.is_sub_item ? 1 : 0, i]
                );
            }
        }
        res.json({ message: "success", id: templateId });
    } catch (error) {
        console.error("Error creating template:", error);
        res.status(500).json({ error: error.message });
    }
};

export const updateTemplate = async (req, res) => {
    const { id } = req.params;
    const { name, items } = req.body;
    try {
        await database.query('UPDATE quotation_templates SET name = ? WHERE id = ?', [name, id]);
        
        // Delete old items and insert new ones
        await database.query('DELETE FROM quotation_template_items WHERE template_id = ?', [id]);
        
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await database.query(
                    'INSERT INTO quotation_template_items (template_id, description, quantity, unit, unit_price, is_sub_item, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [id, item.description || '', item.quantity || 1, item.unit || '', item.unitPrice === "" ? null : item.unitPrice, item.is_sub_item ? 1 : 0, i]
                );
            }
        }
        res.json({ message: "success" });
    } catch (error) {
        console.error("Error updating template:", error);
        res.status(500).json({ error: error.message });
    }
};

export const deleteTemplate = async (req, res) => {
    const { id } = req.params;
    try {
        await database.query('DELETE FROM quotation_templates WHERE id = ?', [id]);
        res.json({ message: "success" });
    } catch (error) {
        console.error("Error deleting template:", error);
        res.status(500).json({ error: error.message });
    }
};
