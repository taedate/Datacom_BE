import { getUrgentOverviewData, getUrgentDigestData } from '../service/urgentOverviewService.js';

export async function getUrgentOverview(req, res) {
    try {
        const data = await getUrgentOverviewData(req.query || {});
        return res.status(200).json(data);
    } catch (error) {
        console.error('getUrgentOverview error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export async function getUrgentOverviewDigest(req, res) {
    try {
        const data = await getUrgentDigestData(req.query || {});
        return res.status(200).json(data);
    } catch (error) {
        console.error('getUrgentOverviewDigest error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
