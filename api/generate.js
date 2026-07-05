const requestLog = new Map();
const MAX_REQUESTS_PER_HOUR = 20;

function isRateLimited(ip) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const timestamps = (requestLog.get(ip) || []).filter(t => t > hourAgo);
    timestamps.push(now);
    requestLog.set(ip, timestamps);
    return timestamps.length > MAX_REQUESTS_PER_HOUR;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Methode nicht erlaubt.' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    }

    const { type, location, size, rooms, highlights } = req.body || {};

    if (!type || !location || !size || !rooms) {
        return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen.' });
    }

    const clean = (str, maxLen) => String(str).slice(0, maxLen).replace(/[\r\n]+/g, ' ');
    const safeType = clean(type, 30);
    const safeLocation = clean(location, 100);
    const safeHighlights = clean(highlights || '', 300);
    const safeSize = Number(size);
    const safeRooms = Number(rooms);

    if (!Number.isFinite(safeSize) || safeSize <= 0 || safeSize > 10000) {
        return res.status(400).json({ error: 'Ungültige Größe.' });
    }
    if (!Number.isFinite(safeRooms) || safeRooms <= 0 || safeRooms > 50) {
        return res.status(400).json({ error: 'Ungültige Zimmerzahl.' });
    }

    const prompt = `Schreibe ein professionelles, ansprechendes Immobilien-Exposé auf Deutsch für folgendes Objekt:
Typ: ${safeType}
Ort: ${safeLocation}
Größe: ${safeSize} m²
Zimmer: ${safeRooms}
Highlights: ${safeHighlights || 'keine besonderen Angaben'}

Der Text soll ca. 150-200 Wörter lang sein, professionell klingen und für ein Immobilien-Exposé geeignet sein.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('OpenAI API Fehler:', errText);
            return res.status(502).json({ error: 'Fehler beim Generieren des Textes. Bitte später erneut versuchen.' });
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;

        if (!text) {
            return res.status(502).json({ error: 'Keine Antwort erhalten. Bitte erneut versuchen.' });
        }

        return res.status(200).json({ text });
    } catch (error) {
        console.error('Serverfehler:', error);
        return res.status(500).json({ error: 'Interner Serverfehler.' });
    }
};
