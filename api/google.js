// Vercel serverless function to proxy Google Custom Search API requests
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { q, apiKey: userApiKey, cx: userCseId } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Missing required parameter: q (search query)'
            });
        }

        // Use user-provided keys or fallback to environment variables
        const apiKey = userApiKey || process.env.GOOGLE_API_KEY;
        const cseId = userCseId || process.env.GOOGLE_CSE_ID;

        if (!apiKey || !cseId) {
            console.warn('No Google API credentials provided');
            return res.status(200).json({ items: [], searchInformation: { totalResults: '0' }, noKey: true });
        }

        // Google Custom Search API - dateRestrict=m1 limits to last month
        const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(q)}&num=10&dateRestrict=m1`;

        console.log(`Proxying Google Custom Search request for: ${q}`);

        const response = await fetch(googleUrl);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Google API error: ${response.status} ${response.statusText} - ${errorText}`);
            return res.status(200).json({ items: [], searchInformation: { totalResults: '0' }, error: `API error: ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error('Google proxy error:', error);
        return res.status(200).json({ items: [], searchInformation: { totalResults: '0' }, error: error.message });
    }
}
