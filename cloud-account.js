window.CloudAccount = (() => {
    'use strict';
    // The SDK persists only its authentication session on this device, never portfolio data.
    const client = window.supabase.createClient('https://mpoaaemubklcrjaolpon.supabase.co',
        'sb_publishable_RnZO2mzbt8QXwza8pHSllA_CX2PYBux');
    let session = null, version = 0, baseline = {}, saving = null, paused = false, ready = false;
    let message = 'Connecting to Supabase…';
    function status(text, error = false) {
        message = text;
        const element = document.getElementById('cloud-sync-status');
        if (element) { element.textContent = text; element.classList.toggle('sync-error', error); }
    }
    const equal = (a, b) => Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
    const snapshot = () => appStorage.snapshot();
    const dirty = () => !equal(snapshot(), baseline);
    async function load() {
        const { data, error } = await client.rpc('load_account_state');
        if (error) throw error;
        if (data.state !== null && (data.state.schema !== 1 || !data.state.records)) {
            throw new Error('Unsupported cloud data format. Loading stopped to protect your account.');
        }
        return data;
    }
    async function persist(records, expectedVersion) {
        const { data, error } = await client.rpc('save_account_state', {
            p_state: { schema: 1, records }, p_version: expectedVersion
        });
        if (error) throw error;
        return data;
    }
    async function flush() {
        if (saving) { await saving; return dirty() ? flush() : undefined; }
        if (paused) throw new Error('Cloud sync is paused. Resolve the changes from your other device first.');
        if (!ready || !session || !dirty()) return;
        const records = snapshot();
        status('Saving…');
        saving = (async () => {
            try {
                version = await persist(records, version);
                baseline = records;
                status('Saved to Supabase');
            } catch (error) {
                if (error.code === 'PT409') {
                    paused = true;
                    status('Newer changes on another device — sync paused. Keep this tab open.', true);
                } else status('Not saved — connection failed. Keep this tab open; retrying.', true);
                throw error;
            }
        })();
        try { await saving; } finally { saving = null; }
    }
    function defaultProfile() {
        const p = session.user.user_metadata.profile || {};
        return {
            firstName: p.firstName || '', lastName: p.lastName || '', phone: p.phone || '',
            country: p.country || 'Australia', currency: p.currency || 'AUD', language: p.language || 'en',
            email: session.user.email, cryptos: [], percentageThresholds: {}, tier: 'free',
            tierSource: 'default', firstLoginComplete: false, createdAt: new Date().toISOString()
        };
    }
    async function start() {
        try {
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            session = data.session;
            if (session) {
                const remote = await load();
                version = remote.version;
                appStorage.replace(remote.state?.records || {});
                const email = session.user.email;
                const profiles = JSON.parse(appStorage.getItem('users') || '{}');
                const profile = profiles[email] || defaultProfile();
                delete profile.password;
                profile.email = email;
                appStorage.setItem('users', JSON.stringify({ [email]: profile }));
                appStorage.setItem('loggedInUser', email);
                baseline = remote.state?.records || {};
                ready = true;
                await flush();
            }
            const script = document.createElement('script');
            script.src = 'scripts.js';
            script.onload = () => {
                ready = true;
                status(session ? 'Saved to Supabase' : 'Cloud account');
            };
            script.onerror = () => status('App could not load. Please reload.', true);
            document.body.appendChild(script);
            setInterval(() => flush().catch(() => {}), 3000);
            setInterval(async () => {
                if (!ready || !session || saving || dirty() || paused || document.hidden) return;
                try {
                    const remote = await load();
                    if (remote.version !== version && !dirty() && !saving) location.reload();
                } catch { status('Cloud connection unavailable. Retrying…', true); }
            }, 30000);
        } catch (error) {
            status('Could not load your cloud account. Reload to retry.', true);
            const notice = document.getElementById('cloud-load-error');
            notice.hidden = false;
            notice.querySelector('p').textContent = error.message;
        }
    }
    async function login(email, password) {
        const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (error) throw error;
        location.reload();
    }
    async function register(profile, password) {
        delete profile.password;
        const { data, error } = await client.auth.signUp({
            email: profile.email.toLowerCase(), password,
            options: { emailRedirectTo: location.origin, data: { profile: {
                firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone,
                country: profile.country, currency: profile.currency, language: profile.language
            } } }
        });
        if (error) throw error;
        if (data.session) location.reload();
        return Boolean(data.session);
    }
    async function logout() {
        await flush();
        if (paused) throw new Error('Resolve the cloud conflict before logging out so unsaved changes are not lost.');
        ready = false;
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
        appStorage.clear();
        location.reload();
    }
    async function changePassword(current, next) {
        const { error: verifyError } = await client.auth.signInWithPassword({ email: session.user.email, password: current });
        if (verifyError) throw verifyError;
        const { error } = await client.auth.updateUser({ password: next });
        if (error) throw error;
    }
    async function deleteAccount() {
        throw new Error('Cloud account deletion is not available yet. Your account and data have not been changed.');
    }
    async function retry() {
        if (paused) {
            document.getElementById('cloud-conflict').showModal();
            return;
        }
        await flush();
    }
    async function resolveConflict(useLocal) {
        if (!paused) return;
        const remote = await load();
        if (useLocal) {
            const records = snapshot();
            version = await persist(records, remote.version);
            baseline = records;
            paused = false;
            status('Saved to Supabase');
            document.getElementById('cloud-conflict').close();
        } else {
            ready = false;
            location.reload();
        }
    }
    window.addEventListener('app-data-changed', () => {
        if (ready && session && !paused) status('Unsaved changes…');
    });
    window.addEventListener('beforeunload', event => {
        if (ready && session && dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    client.auth.onAuthStateChange((event, next) => {
        if (event === 'SIGNED_IN' && session && next?.user.id !== session.user.id) {
            ready = false;
            appStorage.replace({});
            location.reload();
        }
        if (event === 'TOKEN_REFRESHED') session = next;
        if (event === 'SIGNED_OUT' && session) {
            ready = false;
            session = null;
            appStorage.replace({});
            location.reload();
        }
    });
    return { start, login, register, logout, changePassword, deleteAccount, flush, retry, resolveConflict,
        get message() { return message; }, get canPurchase() { return ready && !!session && !paused && navigator.onLine; } };
})();
CloudAccount.start();

