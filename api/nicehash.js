import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://mpoaaemubklcrjaolpon.supabase.co';
const PUBLIC_KEY = 'sb_publishable_RnZO2mzbt8QXwza8pHSllA_CX2PYBux';
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { endpoint, method, headers = {}, body } = req.body || {};
    if (typeof endpoint !== 'string' || !/^\/(?:main\/)?api\/v2\//.test(endpoint) ||
        /[\\\s#]/.test(endpoint) || endpoint.includes('..') ||
        !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        return res.status(400).json({ error: 'Invalid NiceHash request' });
    }
    const mutation = method !== 'GET';
    const publicTime = endpoint === '/api/v2/time' && !mutation;
    const authorization = req.headers.authorization;
    let client;
    const device = req.headers['x-cryptfolio-device'];
    const request = req.headers['x-cryptfolio-request'];
    try {
        if (!publicTime) {
            if (!authorization?.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in required' });
            client = createClient(SUPABASE_URL, PUBLIC_KEY, {
                global: { headers: { Authorization: authorization } },
                auth: { persistSession: false, autoRefreshToken: false }
            });
            const { data, error } = await client.auth.getUser(authorization.slice(7));
            if (error || !data.user) return res.status(401).json({ error: 'Session expired. Sign in again.' });
        }
        if (mutation) {
            if (!uuid(device) || !uuid(request)) return res.status(400).json({ error: 'Missing device or request identity' });
            const { error } = await client.rpc('reserve_automation_action', { p_device: device, p_request: request });
            if (error) return res.status(409).json({ error: error.message });
        }
        const outgoing = { 'Content-Type': 'application/json' };
        for (const name of ['X-Auth', 'X-Time', 'X-Nonce', 'X-Request-Id', 'X-Organization-Id']) {
            if (typeof headers[name] === 'string') outgoing[name] = headers[name];
        }
        const response = await fetch('https://api2.nicehash.com' + endpoint, {
            method, headers: outgoing, redirect: 'error', signal: AbortSignal.timeout(45000),
            body: body == null || method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
        });
        const data = await response.json();
        const miningOrder = method === 'POST' && /^\/main\/api\/v2\/hashpower\/(?:solo\/order|shared\/ticket\/)/.test(endpoint);
        if (miningOrder && response.status >= 200 && response.status < 300) {
            const declined = data?.successType === 'NOT_SUCCESSFUL' || data?.success === false;
            const confirmed = data?.success === true || data?.successType === 'SUCCESSFUL' ||
                (typeof data?.id === 'string' && data.id) || (typeof data?.orderId === 'string' && data.orderId);
            if (data?.successType === 'PARTIAL_SUCCESS' || (!declined && !confirmed)) {
                // Keep the server reservation pending on every device. A partial fill
                // must be reconciled against the provider before another order is sent.
                return res.status(409).json({ error: 'Order requires review in NiceHash. Automatic purchases are paused to prevent a duplicate.',
                    success: false, successType: data?.successType || 'UNCONFIRMED' });
            }
        }
        // An ambiguous timeout/5xx stays pending, blocking retries and failover.
        if (mutation && response.status < 500 && response.status !== 408) {
            const { error } = await client.rpc('receive_automation_action', { p_device: device, p_request: request });
            if (error) throw new Error('Cloud order confirmation failed.');
            res.setHeader('X-Cryptfolio-Received', request);
        }
        return res.status(response.status).json(data);
    } catch {
        return res.status(502).json({ error: mutation
            ? 'Order outcome is uncertain. Check NiceHash; automatic retries are blocked to prevent a duplicate purchase.'
            : 'NiceHash could not be reached. Try again shortly.' });
    }
}
