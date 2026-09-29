window.CloudAccount = (() => {
    'use strict';
    // The SDK persists only its authentication session on this device, never portfolio data.
    const client = window.supabase.createClient('https://mpoaaemubklcrjaolpon.supabase.co',
        'sb_publishable_RnZO2mzbt8QXwza8pHSllA_CX2PYBux', {
            auth: { storage: window.CryptfolioAuthStorage },
            global: { fetch: (url, options = {}) => {
                // Small saves can finish even when a reload closes this page.
                const keepalive = String(url).endsWith('/rpc/patch_account_state') &&
                    typeof options.body === 'string' && new TextEncoder().encode(options.body).length < 60000;
                return fetch(url, { ...options, ...(keepalive ? { keepalive: true } : {}) });
            } }
        });
    let session = null, version = 0, baseline = {}, saving = null, paused = false, ready = false;
    let refreshing = null, saveTimer = null, requestedVersion = 0;
    let checkingRevision = null, renewingLease = null, realtimeConnected = false, lastRevisionCheck = 0;
    let lastSaveAt = 0, saveFailures = 0, retrySaveAt = 0;
    // Frequent market observations should not rewrite the encrypted portfolio on every tick.
    const observationKey = /(?:_display(?:AUD|Value|Holdings)|_easyMiningData|_chartDataStore|_packageStates|_candlestickData|_savedPackageProbabilities|_lastUpdated|_totalHoldings24hAgo|_recordHigh|_recordLow)$/;
    function backgroundFlush() {
        if (saving || Date.now() < retrySaveAt) return;
        const records = snapshot();
        const changed = [...new Set([...Object.keys(records), ...Object.keys(baseline)])]
            .filter(key => records[key] !== baseline[key]);
        if (changed.length && changed.every(key => observationKey.test(key)) && Date.now() - lastSaveAt < 30000) return;
        flush(0, true).catch(() => {});
    }
    const deviceId = crypto.randomUUID(); // Deliberately unique per tab, not shared in browser storage.
    let leaseUntil = 0, automationBusy = false, isAdmin = false;
    const receivedActions = new Set();
    async function renewLease() {
        if (!session || paused) { leaseUntil = 0; return false; }
        if (renewingLease) return renewingLease;
        const startedAt = Date.now();
        renewingLease = (async () => {
            const { data, error } = await client.rpc('claim_automation', { p_device: deviceId });
            // Network delays must not extend the local lease past the server's lease.
            leaseUntil = !error && data === true ? startedAt + 20000 : 0;
            const badge = document.getElementById('cloud-automation-status');
            if (badge) badge.textContent = leaseUntil > Date.now() ? 'Automation: this device' : 'Monitoring • automation on another device or awaiting review';
            return leaseUntil > Date.now();
        })();
        try { return await renewingLease; } finally { renewingLease = null; }
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
    let message = 'Connecting…';
    async function authorizedFetch(url, options) {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) throw new Error('Sign in to continue.');
        return fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + data.session.access_token } });
    }
    function synced() {
        status('Last synced ' + new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }));
    }
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
        const changed = Object.fromEntries(Object.entries(records).filter(([key, value]) => baseline[key] !== value));
        const removed = Object.keys(baseline).filter(key => !Object.hasOwn(records, key));
        const { data, error } = await client.rpc('patch_account_state', {
            p_records: changed, p_removed: removed, p_version: expectedVersion
        });
        if (error) throw error;
        return data;
    }
    async function flush(attempt = 0, background = false) {
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
                lastSaveAt = Date.now();
                saveFailures = 0;
                retrySaveAt = 0;
                synced();
            } catch (error) {
                if (error.code === 'PT409') {
                    const remote = await load();
                    reconcile(remote);
                    status('Syncing changes from both devices…');
                    retryAfterMerge = true;
                    return;
                } else {
                    retrySaveAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(saveFailures++, 5));
                    status('Not saved — connection failed. Keep this tab open; retrying.', true);
                }
                throw error;
            }
        })();
        try { await saving; } finally { saving = null; }
        if (retryAfterMerge) {
            if (attempt >= 3) throw new Error('Both devices are busy saving. Retrying shortly.');
            return flush(attempt + 1, background);
        }
        // Changes made while the request was in flight are sent immediately after it.
        if (dirty()) return background ? backgroundFlush() : flush();
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
        synced();
    }
    async function refresh(remoteVersion = 0) {
        if (!ready || !session || paused) return;
        requestedVersion = Math.max(requestedVersion, Number(remoteVersion) || 0);
        if (refreshing) return refreshing;
        refreshing = (async () => {
            do {
                if (saving) await saving;
                reconcile(await load());
                if (dirty()) await flush();
            } while (requestedVersion > version);
        })();
        try { await refreshing; } finally { refreshing = null; }
    }
    async function checkRevision() {
        if (!ready || !session || paused || !navigator.onLine) return;
        if (checkingRevision) return checkingRevision;
        lastRevisionCheck = Date.now();
        checkingRevision = (async () => {
            const { data, error } = await client.from('account_sync').select('version').eq('user_id', session.user.id).maybeSingle();
            if (error) throw error;
            if (Number(data?.version) > version) await refresh(Number(data.version));
        })();
        try { await checkingRevision; } finally { checkingRevision = null; }
    }
    function scheduleSave() {
        // Batch only the current synchronous action, with no timed save delay.
        if (saveTimer || !ready || !session || paused) return;
        saveTimer = true;
        queueMicrotask(() => { saveTimer = null; backgroundFlush(); });
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
    async function startupStep(task, label, deadlineMs = 20000) {
        const note = document.getElementById('auth-loading-status');
        if (note) { note.textContent = label; note.hidden = true; }
        let timeout, hint;
        try {
            hint = setTimeout(() => { if (note) note.hidden = false; }, 3000);
            return await Promise.race([task, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error(label + ' is taking too long. Your saved account is unchanged. Please retry the connection.')), deadlineMs);
            })]);
        } finally { clearTimeout(timeout); clearTimeout(hint); }
    }
    async function start() {
        try {
            // Startup failures must remain visible while the unhydrated app is hidden.
            const loadNotice = document.getElementById('cloud-load-error');
            if (loadNotice) document.body.appendChild(loadNotice);
            const conflictDialog = document.getElementById('cloud-conflict');
            if (conflictDialog) document.body.appendChild(conflictDialog);
            const remember = document.getElementById('stay-signed-in');
            if (remember) remember.checked = window.CryptfolioAuthStorage?.persistent !== false;
            const { data, error } = await startupStep(client.auth.getSession(), 'Restoring your sign-in');
            if (error) throw error;
            session = data.session;
            if (session) {
                const [remote, access] = await startupStep(Promise.all([load(), client.rpc('get_account_access')]), 'Loading your saved portfolio', 35000);
                version = remote.version;
                appStorage.replace(remote.state?.records || {});
                const email = session.user.email;
                const profiles = JSON.parse(appStorage.getItem('users') || '{}');
                const profile = profiles[email] || defaultProfile();
                if (access.error) throw access.error;
                profile.isAdmin = access.data.isAdmin;
                isAdmin = access.data.isAdmin === true;
                if (profile.isAdmin) { profile.tier = 'elite'; profile.tierSource = 'admin'; }
                delete profile.password;
                profile.email = email;
                appStorage.setItem('users', JSON.stringify({ [email]: profile }));
                appStorage.setItem('loggedInUser', email);
                baseline = remote.state?.records || {};
            }
            const script = document.createElement('script');
            script.src = 'scripts.js';
            script.onload = () => {
                ready = true;
                document.body.classList.remove('auth-loading');
                if (session) synced(); else status('Sign in to sync');
                if (session) {
                    // Display the hydrated app before optional saves, automation or AI work.
                    flush().catch(() => {});
                    renewLease().catch(() => { leaseUntil = 0; });
                    client.channel('account-sync-' + session.user.id)
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'account_sync',
                            filter: 'user_id=eq.' + session.user.id }, payload => {
                                if (Number(payload.new?.version) > version) refresh(Number(payload.new.version)).catch(() => {});
                            })
                        .subscribe(state => {
                            realtimeConnected = state === 'SUBSCRIBED';
                            if (realtimeConnected) checkRevision().catch(() => {});
                        });
                }
                window.dispatchEvent(new CustomEvent('app-ready'));
            };
            script.onerror = () => {
                document.body.classList.add('auth-load-failed');
                document.body.classList.remove('auth-loading');
                status('App could not load. Please reload.', true);
                const notice = document.getElementById('cloud-load-error');
                notice.hidden = false;
                notice.querySelector('p').textContent = 'The app could not load. Please reload to try again.';
            };
            document.body.appendChild(script);
            setInterval(backgroundFlush, 1000);
            setInterval(() => renewLease().catch(() => { leaseUntil = 0; }), 8000);
            setInterval(() => {
                if (!document.hidden && Date.now() - lastRevisionCheck >= (realtimeConnected ? 60000 : 15000)) {
                    // Realtime delivers changes; bounded polling recovers missed events.
                    checkRevision().catch(() => {});
                }
            }, 15000);
        } catch (error) {
            document.body.classList.add('auth-load-failed');
            document.body.classList.remove('auth-loading');
            status('Could not load your cloud account. Reload to retry.', true);
            const notice = document.getElementById('cloud-load-error');
            notice.hidden = false;
            notice.querySelector('p').textContent = error.message;
        }
    }
    async function login(email, password) {
        window.CryptfolioAuthStorage?.setPersistence(document.getElementById('stay-signed-in')?.checked !== false);
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
            synced();
            document.getElementById('cloud-conflict').close();
        } else {
            ready = false;
            location.reload();
        }
    }
    window.addEventListener('app-data-changed', () => {
        if (ready && session && !paused) status('Saving…');
        scheduleSave();
    });
    window.addEventListener('online', () => checkRevision().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) flush().catch(() => {});
        else checkRevision().catch(() => {});
    });
    window.addEventListener('pagehide', () => { flush().catch(() => {}); });
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
        runAutomation, ensureAutomation, proxyFetch, authorizedFetch, confirmActions,
        get isReady() { return ready && !!session; },
        get isAdmin() { return isAdmin; },
        get message() { return message; }, get canPurchase() { return ready && !!session && !paused && navigator.onLine && leaseUntil > Date.now(); } };
})();
CloudAccount.start();

