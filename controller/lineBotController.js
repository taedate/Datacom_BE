import {
    verifyLineSignature,
    replyMessage,
    textMessage,
    buildQuickReply,
    cancelQuickReply,
    skipImageQuickReply,
    createClosedSundayFlex,
    createSummaryFlex,
    createLocationCard,
    createHelpImagemap,
    renderHelpImagemap,
    findRepairStatus,
    formatRepairStatusReply
} from '../service/lineBotService.js';

const sessions = new Map();
const userData = new Map();

function getNowBangkok() {
    const local = new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    return new Date(local);
}

function isSundayBangkok() {
    return getNowBangkok().getDay() === 0;
}

function clearUserFlow(userId) {
    sessions.delete(userId);
    userData.delete(userId);
}

function setState(userId, state) {
    sessions.set(userId, state);
}

function getState(userId) {
    return sessions.get(userId) || 'IDLE';
}

export async function callback(req, res) {
    try {
        const signature = req.headers['x-line-signature'];
        const rawBody = req.rawBody;

        if (!verifyLineSignature(rawBody, signature)) {
            return res.status(403).send('Invalid signature');
        }

        const events = req.body?.events || [];

        for (const event of events) {
            await handleEvent(event);
        }

        return res.status(200).send('OK');
    } catch (error) {
        console.error('LINE callback error:', error);
        return res.status(500).send('Internal Server Error');
    }
}

export async function serveHelpImagemap(req, res) {
    const size = Number(req.params.size);

    try {
        const buffer = await renderHelpImagemap(size);
        res.setHeader('Content-Type', 'image/png');
        return res.status(200).send(buffer);
    } catch (error) {
        console.error(error.message);
        return res.status(error.statusCode || 500).send('Not Found');
    }
}

async function handleEvent(event) {
    if (event.type !== 'message') return;
    if (!event.replyToken) return;

    const messageType = event.message?.type;
    if (!['text', 'image'].includes(messageType)) return;

    const userId = event.source?.userId;
    if (!userId) return;

    const isImage = messageType === 'image';
    const text = isImage ? '__IMAGE__' : (event.message.text || '').trim();
    const state = getState(userId);

    const allowedOnSunday = new Set([
        'ช่วยเหลือ',
        'เวลาเปิดปิด',
        'ติดต่อด่วนโทร',
        'คำถามอื่นๆ',
        'แผนที่',
        'ติดต่อเรา',
        'ยกเลิก',
        'เช็คไอดีกลุ่ม'
    ]);

    if (text === 'เช็คไอดีกลุ่ม') {
        const sourceType = event.source?.type;

        if (sourceType === 'group') {
            await replyMessage(event.replyToken, textMessage(`Group ID: ${event.source.groupId || '-'}`));
            return;
        }

        if (sourceType === 'room') {
            await replyMessage(event.replyToken, textMessage(`Room ID: ${event.source.roomId || '-'}`));
            return;
        }

        await replyMessage(event.replyToken, textMessage(`User ID: ${event.source?.userId || '-'}`));
        return;
    }

    // Sunday blocking is disabled: allow normal chatbot flow every day.

    if (text === 'ยกเลิก') {
        setState(userId, 'IDLE');
        userData.delete(userId);
        await replyMessage(
            event.replyToken,
            textMessage('ยกเลิกรายการเรียบร้อยแล้วครับ หากต้องการสอบถามเพิ่มเติมเลือกเมนูด้านล่างได้เลยนะครับ')
        );
        return;
    }

    if (state === 'IDLE') {
        await handleIdle(event, text, userId);
        return;
    }

    if (state === 'CHECK_STATUS') {
        await handleCheckStatus(event, text, userId);
        return;
    }

    if (state.startsWith('REPAIR_')) {
        await handleRepair(event, text, userId, state, isImage);
        return;
    }

    if (state.startsWith('ORG_')) {
        await handleOrg(event, text, userId, state, isImage);
        return;
    }

    if (state.startsWith('INQUIRY_')) {
        await handleInquiry(event, text, userId, state, isImage);
        return;
    }

    setState(userId, 'IDLE');
}

async function handleIdle(event, text, userId) {
    if (text === 'ติดต่อเรา' || text === 'แผนที่') {
        await replyMessage(event.replyToken, createLocationCard());
        return;
    }

    if (text === 'ช่วยเหลือ') {
        await replyMessage(event.replyToken, createHelpImagemap());
        return;
    }

    if (text === 'ตรวจสอบสถานะงานซ่อม') {
        setState(userId, 'CHECK_STATUS');
        await replyMessage(
            event.replyToken,
            textMessage(
                "สามารถตรวจสอบสถานะได้ง่ายๆ ครับ รบกวนพิมพ์ 'เบอร์โทรศัพท์' หรือ 'รหัสงานซ่อม' ส่งมาได้เลยครับ",
                cancelQuickReply()
            )
        );
        return;
    }

    if (text === 'แจ้งซ่อม') {
        setState(userId, 'REPAIR_TYPE');
        const qr = buildQuickReply([
            { label: 'คอมพิวเตอร์', text: 'คอมพิวเตอร์' },
            { label: 'ปริ้นเตอร์', text: 'ปริ้นเตอร์' },
            { label: 'อุปกรณ์อื่น', text: 'อุปกรณ์อื่น' },
            { label: 'ยกเลิก', text: 'ยกเลิก' }
        ]);

        await replyMessage(
            event.replyToken,
            textMessage('คุณลูกค้าต้องการแจ้งซ่อมอุปกรณ์ประเภทไหนครับ?', qr)
        );
        return;
    }

    if (text === 'สั่งซื้อหน่วยงาน') {
        setState(userId, 'ORG_DETAIL');
        const promptText = [
            'สำหรับลูกค้าองค์กร/หน่วยงาน รบกวนแจ้งรายละเอียดเบื้องต้นตามนี้',
            '',
            '- ชื่อหน่วยงาน:',
            '- รายการสินค้าและจำนวนที่ต้องการ:',
            '',
            '(หลังจากได้รับข้อมูล แอดมินจะรีบตรวจสอบและจัดทำใบเสนอราคาให้ครับ)'
        ].join('\n');

        await replyMessage(event.replyToken, textMessage(promptText, cancelQuickReply()));
        return;
    }

    if (text === 'สอบถามสินค้า') {
        setState(userId, 'INQUIRY_PRODUCT');
        await replyMessage(
            event.replyToken,
            textMessage('สนใจสอบถามสินค้าตัวไหนหรือกำลังตามหาอุปกรณ์ชิ้นไหนอยู่ แจ้งได้เลยครับ', cancelQuickReply())
        );
        return;
    }

    if (text === 'เวลาเปิดปิด') {
        await replyMessage(
            event.replyToken,
            textMessage('ร้านเปิดให้บริการ จันทร์-เสาร์ เวลา 08:30 - 18:30 น. (หยุดวันอาทิตย์)')
        );
        return;
    }

    if (text === 'ติดต่อด่วนโทร') {
        await replyMessage(
            event.replyToken,
            textMessage('โทรติดต่อด่วน: 098-794-6235, 06-1994-1928\nโทรติดต่อเบอร์ร้าน: 056-223-547')
        );
        return;
    }

    if (text === 'คำถามอื่นๆ') {
        await replyMessage(
            event.replyToken,
            textMessage('สามารถพิมพ์คำถามหรือข้อสงสัยทิ้งไว้ได้เลยครับ แอดมินจะรีบเข้ามาตอบกลับให้เร็วที่สุดครับ')
        );
        return;
    }

    const qr = buildQuickReply([
        { label: 'แจ้งซ่อม', text: 'แจ้งซ่อม' },
        { label: 'สั่งซื้อหน่วยงาน', text: 'สั่งซื้อหน่วยงาน' },
        { label: 'สอบถามสินค้า', text: 'สอบถามสินค้า' },
        { label: 'ช่วยเหลือ', text: 'ช่วยเหลือ' },
        { label: 'ติดต่อเรา', text: 'ติดต่อเรา' }
    ]);

    const greetingText = [
        'สวัสดีครับ Datacom Service ยินดีให้บริการครับ',
        'คุณลูกค้าต้องการให้เราดูแลเรื่องไหน สามารถเลือกเมนูด้านล่างได้เลยครับ'
    ].join('\n');

    await replyMessage(event.replyToken, textMessage(greetingText, qr));
}

async function handleCheckStatus(event, text, userId) {
    setState(userId, 'IDLE');

    try {
        const rows = await findRepairStatus(text);
        const responseText = formatRepairStatusReply(text, rows);
        await replyMessage(event.replyToken, textMessage(responseText));
    } catch (error) {
        console.error('Failed to find repair status:', error);
        await replyMessage(
            event.replyToken,
            textMessage(`กำลังตรวจสอบข้อมูลของ: ${text}\n(ระบบกำลังประมวลผล แอดมินจะรีบแจ้งความคืบหน้าให้ครับ)`)
        );
    }
}

async function handleRepair(event, text, userId, state, isImage) {
    if (state === 'REPAIR_TYPE') {
        userData.set(userId, { type: text });
        setState(userId, 'REPAIR_DETAIL');

        const promptText = [
            'รบกวนแจ้งรายละเอียดตามนี้ เพื่อให้ช่างประเมินได้แม่นยำขึ้น',
            '- ยี่ห้อ:',
            '- รุ่น:',
            '- อาการที่พบ:',
            '(สามารถพิมพ์รวมกันแล้วส่งมาในข้อความเดียวได้เลยครับ)'
        ].join('\n');

        await replyMessage(event.replyToken, textMessage(promptText, cancelQuickReply()));
        return;
    }

    if (state === 'REPAIR_DETAIL') {
        const data = userData.get(userId) || {};
        data.detail = text;
        userData.set(userId, data);

        setState(userId, 'REPAIR_IMAGE');
        await replyMessage(
            event.replyToken,
            textMessage('หากมีรูปภาพอุปกรณ์หรืออาการเสีย สามารถส่งมาได้เลยครับ (ถ้าไม่มี กด ข้าม ได้ครับ)', skipImageQuickReply())
        );
        return;
    }

    if (state === 'REPAIR_IMAGE') {
        const data = userData.get(userId) || {};
        clearUserFlow(userId);
        setState(userId, 'IDLE');

        const card = createSummaryFlex(
            'บันทึกแจ้งซ่อม',
            [
                ['อุปกรณ์', data.type || '-'],
                ['รายละเอียด', data.detail || '-'],
                ['รูปภาพ', isImage ? 'มี' : 'ไม่มี'],
                ['สถานะ', 'รอประเมินราคา']
            ],
            'รับเรื่องเรียบร้อย แอดมินจะติดต่อกลับครับ',
            'https://github.com/taedate/DATACOM-ImageV2/blob/main/PleaseWaitadminreply2.png?raw=true'
        );

        await replyMessage(event.replyToken, card);
    }
}

async function handleOrg(event, text, userId, state, isImage) {
    if (state === 'ORG_DETAIL') {
        userData.set(userId, { detail: text });
        setState(userId, 'ORG_IMAGE');
        await replyMessage(
            event.replyToken,
            textMessage('หากมีรูปภาพตัวอย่างสินค้า สามารถส่งมาได้เลยครับ (ถ้าไม่มี กด ข้าม ได้ครับ)', skipImageQuickReply())
        );
        return;
    }

    if (state === 'ORG_IMAGE') {
        const data = userData.get(userId) || {};
        clearUserFlow(userId);
        setState(userId, 'IDLE');

        const card = createSummaryFlex(
            'คำสั่งซื้อหน่วยงาน',
            [
                ['รายละเอียด', data.detail || '-'],
                ['รูปภาพ', isImage ? 'มี' : 'ไม่มี'],
                ['สถานะ', 'รอตรวจสอบสต็อก']
            ],
            'รับเรื่องเรียบร้อย แอดมินจะจัดส่งใบเสนอราคาให้ครับ',
            'https://github.com/taedate/DATACOM-ImageV2/blob/main/PleaseWaitadminreply2.png?raw=true'
        );

        await replyMessage(event.replyToken, card);
    }
}

async function handleInquiry(event, text, userId, state, isImage) {
    if (state === 'INQUIRY_PRODUCT') {
        userData.set(userId, { product: text });
        setState(userId, 'INQUIRY_IMAGE');
        await replyMessage(
            event.replyToken,
            textMessage('มีรูปภาพสินค้าตัวอย่างไหมครับ? (ถ้าไม่มี กด ข้าม ได้ครับ)', skipImageQuickReply())
        );
        return;
    }

    if (state === 'INQUIRY_IMAGE') {
        const data = userData.get(userId) || {};
        clearUserFlow(userId);
        setState(userId, 'IDLE');

        const card = createSummaryFlex(
            'สอบถามสินค้า',
            [
                ['สินค้า', data.product || '-'],
                ['รูปภาพ', isImage ? 'มี' : 'ไม่มี'],
                ['สถานะ', 'รอแอดมินตอบ']
            ],
            'ระบบได้รับข้อความแล้ว กำลังเรียกแอดมินครับ',
            'https://github.com/taedate/DATACOM-ImageV2/blob/main/PleaseWaitadminreply2.png?raw=true'
        );

        await replyMessage(event.replyToken, card);
    }
}
