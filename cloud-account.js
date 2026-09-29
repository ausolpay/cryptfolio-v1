window.CloudAccount = (() => {
    'use strict';
    // The SDK persists only its authentication session on this device, never portfolio data.
    const client = window.supabase.createClient('https://mpoaaemubklcrjaolpon.supabase.co',
        'sb_publishable_RnZO2mzbt8QXwza8pHSllA_CX2PYBux', { auth: { storage: window.CryptfolioAuthStorage } });
    let session = null, version = 0, baseline = {}, saving = null, paused = false, ready = false;
    let refreshing = null, saveTimer = null;
    const deviceId = crypto.randomUUID(); // Deliberately unique per tab, not shared in browser storage.
    let leaseUntil = 0, automationBusy = false, isAdmin = false;
    const receivedActions = new Set();
    async function renewLease() {
        if (!session || paused) { leaseUntil = 0; return false; }
        const { data, error } = await client.rpc('claim_automation', { p_device: deviceId });
        leaseUntil = !error && data === true ? Date.now() + 20000 : 0;
        const badge = document.getElementById('cloud-automation-status');
        if (badge) badge.textContent = leaseUntil ? 'Automation: this device' : 'Monitoring • automation on another device or awaiting review';
        return leaseUntil > Date.now();
    }
    async function ensureAutomation() {
        if (!ready || !session || paused || !navigator.onLine) return false;
        if (!(await renewLease())) return false;
        await refresh();
        await flush();
        return !paused && leaseUntil > Date.now();
    }
    async function confirmActions() {
        if (!receivedActions.size) return;
        appStorage.setItem('lastConfirmedMiningAction', JSON.stringify({ ids: [...receivedActions], at: Date.now() }));
        await flush();
        if (dirty()) await flush();
        for (const id of receivedActions) {
            const { error } = await client.rpc('acknowledge_automation_action', { p_device: deviceId, p_request: id });
            if (error) throw error;
            receivedActions.delete(id);
        }
    }
    async function runAutomation(task, requireControl = false) {
        if (automationBusy) {
            if (requireControl) throw new Error('Another order is being processed. Please wait.');
            return;
        }
        automationBusy = true;
        try {
            if (!(await ensureAutomation())) {
                if (requireControl) throw new Error('This device is monitoring. Place orders on the device running automation.');
                return;
            }
            const result = await task();
            await flush();
            await confirmActions();
            return result;
        } finally { automationBusy = false; }
    }
    async function proxyFetch(url, options) {
        const payload = JSON.parse(options.body);
        const mutation = payload.method !== 'GET';
        if (mutation) await confirmActions();
        if (mutation && !(await ensureAutomation())) throw new Error('This device is monitoring. Another device owns automation or an earlier order needs review.');
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) throw new Error('Sign in to use NiceHash.');
        const requestId = mutation ? crypto.randomUUID() : '';
        const response = await fetch(url, { ...options, headers: { ...options.headers,
            Authorization: 'Bearer ' + data.session.access_token,
            'X-Cryptfolio-Device': deviceId, 'X-Cryptfolio-Request': requestId } });
        if (mutation && response.headers.get('X-Cryptfolio-Received') === requestId) receivedActions.add(requestId);
        if (mutation && !response.ok && !receivedActions.has(requestId)) {
            leaseUntil = 0;
            status('Order not confirmed. Automation paused; check NiceHash before retrying.', true);
        }
        return response;
    }
    let message = 'Connecting to Supabase…';
    function status(text, error = false) {
        message = text;
        const element = document.getElementById('cloud-sync-status');
        if (element) { element.textContent = text; element.classList.toggle('sync-error', error); }
        const mobile = document.getElementById('mobile-sync-status');
        if (mobile) { mobile.textContent = text; mobile.classList.toggle('sync-error', error); }
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
    async function flush(attempt = 0) {
        if (saving) { await saving; return dirty() ? flush() : undefined; }
        if (paused) throw new Error('Cloud sync is paused. Resolve the changes from your other device first.');
        if (!ready || !session || !dirty()) return;
        const records = snapshot();
        let retryAfterMerge = false;
        status('Saving…');
        saving = (async () => {
            try {
                version = await persist(records, version);
                baseline = records;
                status('Saved to Supabase');
            } catch (error) {
                if (error.code === 'PT409') {
                    const remote = await load();
                    reconcile(remote);
                    status('Syncing changes from both devices…');
                    retryAfterMerge = true;
                    return;
                } else status('Not saved — connection failed. Keep this tab open; retrying.', true);
                throw error;
            }
        })();
        try { await saving; } finally { saving = null; }
        if (retryAfterMerge) {
            if (attempt >= 3) throw new Error('Both devices are busy saving. Retrying shortly.');
            return flush(attempt + 1);
        }
    }
    function reconcile(remote) {
        if (remote.version <= version) return;
        const before = snapshot();
        const merged = CloudData.mergeRecords(baseline, before, remote.state?.records || {});
        if (merged.conflicts.length) {
            paused = true;
            status('Both devices edited the same data — tap to resolve.', true);
            throw new Error('Cloud conflict: keep this tab open and choose which changes to keep.');
        }
        version = remote.version;
        baseline = remote.state?.records || {};
        appStorage.replace(merged.records);
        const keys = [...new Set([...Object.keys(before), ...Object.keys(merged.records)])]
            .filter(key => before[key] !== merged.records[key]);
        if (keys.length) window.dispatchEvent(new CustomEvent('cloud-data-loaded', { detail: { keys } }));
        status('Synced with Supabase');
    }
    async function refresh() {
        if (!ready || !session || paused) return;
        if (refreshing) return refreshing;
        refreshing = (async () => {
            if (saving) await saving;
            reconcile(await load());
            if (dirty()) await flush();
        })();
        try { await refreshing; } finally { refreshing = null; }
    }
    function scheduleSave() {
        // Leading-edge batching avoids starvation during continuous market updates.
        if (saveTimer || !ready || !session || paused) return;
        saveTimer = setTimeout(() => { saveTimer = null; flush().catch(() => {}); }, 400);
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
                const access = await client.rpc('get_account_access');
                if (access.error) throw access.error;
                profile.isAdmin = access.data.isAdmin;
                isAdmin = access.data.isAdmin === true;
                if (profile.isAdmin) { profile.tier = 'elite'; profile.tierSource = 'admin'; }
                delete profile.password;
                profile.email = email;
                appStorage.setItem('users', JSON.stringify({ [email]: profile }));
                appStorage.setItem('loggedInUser', email);
                baseline = remote.state?.records || {};
                ready = true;
                await flush();
                await renewLease();
            }
            const script = document.createElement('script');
            script.src = 'scripts.js';
            script.onload = () => {
                ready = true;
                status(session ? 'Saved to Supabase' : 'Sign in to sync');
                if (session) {
                    client.channel('account-sync-' + session.user.id)
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'account_sync',
                            filter: 'user_id=eq.' + session.user.id }, () => refresh().catch(() => {}))
                        .subscribe(state => { if (state === 'SUBSCRIBED') refresh().catch(() => {}); });
                }
            };
            script.onerror = () => status('App could not load. Please reload.', true);
            document.body.appendChild(script);
            setInterval(() => flush().catch(() => {}), 3000);
            setInterval(() => renewLease().catch(() => { leaseUntil = 0; }), 8000);
            setInterval(() => {
                if (!document.hidden) refresh().catch(() => {});
            }, 5000);
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
        scheduleSave();
    });
    window.addEventListener('online', () => refresh().catch(() => {}));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => {}); });
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
    return { start, login, register, logout, changePassword, deleteAccount, flush, refresh, retry, resolveConflict,
        runAutomation, ensureAutomation, proxyFetch, confirmActions,
        get isAdmin() { return isAdmin; },
        get message() { return message; }, get canPurchase() { return ready && !!session && !paused && navigator.onLine && leaseUntil > Date.now(); } };
})();
CloudAccount.start();

