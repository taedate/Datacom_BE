import crypto from 'crypto';
import axios from 'axios';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import database from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

function getChannelAccessToken() {
    return process.env.CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
}

function getChannelSecret() {
    return process.env.CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET || '';
}

export function verifyLineSignature(rawBody, signature) {
    const secret = getChannelSecret();
    if (!secret || !rawBody || !signature) return false;

    const expected = crypto
        .createHmac('SHA256', secret)
        .update(rawBody)
        .digest('base64');

    return expected === signature;
}

export async function replyMessage(replyToken, messages) {
    const token = getChannelAccessToken();
    if (!token) {
        throw new Error('LINE channel access token is missing (CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_ACCESS_TOKEN).');
    }

    const payload = {
        replyToken,
        messages: Array.isArray(messages) ? messages : [messages]
    };

    await axios.post(LINE_REPLY_ENDPOINT, payload, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });
}

export function textMessage(text, quickReply) {
    const message = {
        type: 'text',
        text
    };

    if (quickReply) {
        message.quickReply = quickReply;
    }

    return message;
}

export function buildQuickReply(buttons) {
    return {
        items: buttons.map((button) => ({
            type: 'action',
            action: {
                type: 'message',
                label: button.label,
                text: button.text
            }
        }))
    };
}

export function cancelQuickReply() {
    return buildQuickReply([{ label: 'ยกเลิก', text: 'ยกเลิก' }]);
}

export function skipImageQuickReply() {
    return buildQuickReply([
        { label: 'ไม่ใส่รูป (ข้าม)', text: 'ข้าม' },
        { label: 'ยกเลิก', text: 'ยกเลิก' }
    ]);
}

export function createClosedSundayFlex() {
    return {
        type: 'flex',
        altText: 'ร้านปิดทำการวันอาทิตย์',
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                contents: [
                    {
                        type: 'text',
                        text: 'ร้านปิดให้บริการ',
                        weight: 'bold',
                        size: 'xl',
                        color: '#e53935'
                    },
                    {
                        type: 'separator',
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'md',
                        spacing: 'sm',
                        contents: [
                            {
                                type: 'text',
                                text: 'วันนี้ (วันอาทิตย์) ร้าน Datacom Service ปิดทำการครับ',
                                wrap: true,
                                size: 'md'
                            },
                            {
                                type: 'text',
                                text: 'เปิดทำการปกติ: จันทร์ - เสาร์ (08:30 - 18:30 น.)',
                                wrap: true,
                                size: 'sm',
                                color: '#666666'
                            },
                            {
                                type: 'text',
                                text: "สามารถใช้งานเมนู 'ช่วยเหลือ' ได้ตามปกติ หรือฝากข้อความไว้ได้ครับ",
                                wrap: true,
                                size: 'sm',
                                color: '#666666'
                            }
                        ]
                    }
                ]
            }
        }
    };
}

export function createSummaryFlex(title, items, footerText, imageUrl = null) {
    const bodyContents = [
        {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'lg',
            wrap: true
        },
        {
            type: 'separator',
            margin: 'md'
        }
    ];

    for (const [label, value] of items) {
        bodyContents.push({
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'md',
            contents: [
                {
                    type: 'text',
                    text: label,
                    color: '#aaaaaa',
                    size: 'sm',
                    flex: 2
                },
                {
                    type: 'text',
                    text: String(value),
                    wrap: true,
                    color: '#666666',
                    size: 'sm',
                    flex: 5
                }
            ]
        });
    }

    const bubble = {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'lg',
            contents: bodyContents
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            contents: [
                {
                    type: 'separator'
                },
                {
                    type: 'text',
                    text: footerText,
                    color: '#aaaaaa',
                    size: 'xs',
                    align: 'center',
                    margin: 'md'
                }
            ]
        }
    };

    if (imageUrl) {
        bubble.hero = {
            type: 'image',
            url: imageUrl,
            size: 'full',
            aspectRatio: '4:3',
            aspectMode: 'cover'
        };
    }

    return {
        type: 'flex',
        altText: title,
        contents: bubble
    };
}

export function createLocationCard() {
    return {
        type: 'flex',
        altText: 'ที่ตั้งร้าน Datacom Service',
        contents: {
            type: 'bubble',
            hero: {
                type: 'image',
                url: 'https://github.com/taedate/datacom-image/blob/main/Datacom.jpg?raw=true',
                size: 'full',
                aspectRatio: '2.35:1',
                aspectMode: 'cover',
                action: {
                    type: 'uri',
                    uri: 'https://www.google.com/maps'
                }
            },
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'lg',
                contents: [
                    {
                        type: 'text',
                        text: 'Datacom Service',
                        weight: 'bold',
                        size: 'xl'
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'md',
                        contents: [
                            {
                                type: 'text',
                                text: '123 ถ.สุขุมวิท กรุงเทพฯ',
                                wrap: true
                            },
                            {
                                type: 'text',
                                text: '09:00 - 18:30 น. (จ-ส)',
                                wrap: true
                            }
                        ]
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        action: {
                            type: 'uri',
                            label: 'โทรติดต่อ',
                            uri: 'tel:0812345678'
                        }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: {
                            type: 'uri',
                            label: 'แผนที่นำทาง',
                            uri: 'https://www.google.com/maps'
                        }
                    }
                ]
            }
        }
    };
}

export function createHelpImagemap() {
    const baseUrl = process.env.LINE_IMAGEMAP_BASE_URL || 'https://datacom-chatbot.onrender.com/imagemap/help';

    return {
        type: 'imagemap',
        baseUrl,
        altText: 'เมนูช่วยเหลือ',
        baseSize: {
            height: 520,
            width: 1040
        },
        actions: [
            {
                type: 'uri',
                linkUri: 'https://maps.app.goo.gl/i6819NkupemvipH9A',
                area: { x: 27, y: 30, width: 484, height: 166 }
            },
            {
                type: 'message',
                text: 'เวลาเปิดปิด',
                area: { x: 534, y: 31, width: 479, height: 163 }
            },
            {
                type: 'uri',
                linkUri: 'https://datacom-service.com/',
                area: { x: 26, y: 221, width: 487, height: 170 }
            },
            {
                type: 'message',
                text: 'ติดต่อด่วนโทร',
                area: { x: 535, y: 221, width: 476, height: 169 }
            },
            {
                type: 'message',
                text: 'คำถามอื่นๆ',
                area: { x: 29, y: 412, width: 985, height: 87 }
            }
        ]
    };
}

export async function renderHelpImagemap(size) {
    const allowedSizes = new Set([1040, 700, 460, 300, 240]);
    if (!allowedSizes.has(size)) {
        const err = new Error('Invalid imagemap size');
        err.statusCode = 404;
        throw err;
    }

    const originalImagePath = path.join(__dirname, '..', 'static', 'help_menu.png');

    try {
        const buffer = await sharp(originalImagePath)
            .resize({ width: size })
            .png({ quality: 85 })
            .toBuffer();

        return buffer;
    } catch (error) {
        const err = new Error(`Error processing imagemap: ${error.message}`);
        err.statusCode = 404;
        throw err;
    }
}

export async function findRepairStatus(keyword) {
    const text = (keyword || '').trim();
    if (!text) return [];

    const clean = text.replace(/[^0-9A-Za-z-]/g, '');
    const cleanPhone = text.replace(/[^0-9]/g, '');

    const params = [];
    let where = 'WHERE 1=0';

    if (clean) {
        where += ' OR caseId = ?';
        params.push(clean);
    }

    if (cleanPhone.length >= 3) {
        where += " OR REPLACE(REPLACE(cusPhone, '-', ''), ' ', '') LIKE ?";
        params.push(`%${cleanPhone}%`);
    }

    const sql = `
        SELECT
            caseId,
            caseType,
            caseStatus,
            caseBrand,
            caseModel,
            updated_at,
            created_at
        FROM caseRepair
        ${where}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 5
    `;

    const [rows] = await database.query(sql, params);
    return rows;
}

export function formatRepairStatusReply(keyword, rows) {
    if (!rows || rows.length === 0) {
        return `ไม่พบข้อมูลจาก: ${keyword}\nรบกวนตรวจสอบเบอร์โทรศัพท์หรือรหัสงานซ่อมอีกครั้งครับ`;
    }

    const lines = [`ผลการค้นหา: ${keyword}`];

    for (const row of rows) {
        const device = [row.caseBrand, row.caseModel].filter(Boolean).join(' ').trim() || row.caseType || '-';
        lines.push(`- ${row.caseId}: ${row.caseStatus} (${device})`);
    }

    lines.push('หากต้องการรายละเอียดเพิ่มเติม แอดมินจะรีบติดต่อกลับครับ');

    return lines.join('\n');
}
