const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

test('the AI verifier checks real ES256 signatures and expiry without an account lookup', async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const key = { ...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-signing-key', alg: 'ES256' };
    let networkRequests = 0;
    const client = createClient('https://verification.test', 'test-only-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async () => { networkRequests++; throw new Error('Unexpected account lookup'); } }
    });
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'ES256', typ: 'JWT', kid: key.kid });
    async function token(exp) {
        const payload = encode({ sub: 'test-owner', exp, email: 'test@example.invalid' });
        const input = header + '.' + payload;
        const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(input));
        return input + '.' + Buffer.from(signature).toString('base64url');
    }
    const jwt = await token(Math.floor(Date.now() / 1000) + 60);
    const verified = await client.auth.getClaims(jwt, { jwks: { keys: [key] } });
    assert.equal(verified.error, null);
    assert.equal(verified.data.claims.sub, 'test-owner');
    const parts = jwt.split('.');
    parts[1] = encode({ ...verified.data.claims, sub: 'forged-owner' });
    const forged = await client.auth.getClaims(parts.join('.'), { jwks: { keys: [key] } });
    assert.equal(forged.error.name, 'AuthInvalidJwtError');
    const expired = await client.auth.getClaims(await token(Math.floor(Date.now() / 1000) - 60), { jwks: { keys: [key] } });
    assert.equal(expired.error.name, 'AuthInvalidJwtError');
    assert.equal(networkRequests, 0);
});
