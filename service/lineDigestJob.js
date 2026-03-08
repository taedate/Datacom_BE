import axios from 'axios';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { getUrgentDigestData, getBangkokTodayString } from './urgentOverviewService.js';

dotenv.config();

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const MAX_RETRY = 3;

async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pushLineMessage(text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = process.env.LINE_TARGET_ID;

    if (!token || !targetId) {
        console.warn('LINE digest skipped: LINE_CHANNEL_ACCESS_TOKEN or LINE_TARGET_ID is missing.');
        return { success: false, reason: 'missing_env' };
    }

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
        try {
            await axios.post(
                LINE_PUSH_ENDPOINT,
                {
                    to: targetId,
                    messages: [
                        {
                            type: 'text',
                            text
                        }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            console.log(`LINE digest pushed successfully (attempt ${attempt}).`);
            return { success: true };
        } catch (error) {
            lastError = error;
            const status = error?.response?.status || 'N/A';
            const detail = error?.response?.data || error.message;
            console.error(`LINE digest push failed (attempt ${attempt}/${MAX_RETRY}). status=${status}`, detail);

            if (attempt < MAX_RETRY) {
                await wait(attempt * 1000);
            }
        }
    }

    return { success: false, reason: lastError?.message || 'push_failed' };
}

export async function runLineDigestNow() {
    try {
        const digest = await getUrgentDigestData({
            date: getBangkokTodayString(),
            warnDays: 3,
            criticalDays: 5
        });

        const result = await pushLineMessage(digest.lineText);
        if (!result.success) {
            console.error('LINE digest finished with failure:', result.reason);
        }
        return { digest, result };
    } catch (error) {
        console.error('LINE digest job failed:', error);
        return { digest: null, result: { success: false, reason: error.message } };
    }
}

export function startLineDigestJob() {
    cron.schedule(
        '30 8 * * *',
        async () => {
            await runLineDigestNow();
        },
        {
            timezone: 'Asia/Bangkok'
        }
    );

    console.log('LINE digest job scheduled at 08:30 Asia/Bangkok.');
}
