const AIOverview = (() => {
    let busy = false;
    const dailyAttempts = new Set();
    let backgroundTimer;
    function scheduleDaily() {
        if (backgroundTimer || !CloudAccount.isReady) return;
        // Let login finish and the portfolio paint before collecting AI context.
        backgroundTimer = setTimeout(() => { backgroundTimer = null; checkDaily(); }, 1500);
    }
    const summaryDay = () => new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const key = () => `${loggedInUser}_aiSettings`;
    const settings = () => { try { return JSON.parse(appStorage.getItem(key()) || '{}'); } catch { return {}; } };
    const active = () => settings().enabled === true && Boolean(settings().apiKey) && ['gemini', 'openai'].includes(settings().provider);
    function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
    const scopeFor = kind => kind === 'coin' ? currentCryptoId : 'portfolio';
    function records(scope) {
        return Object.entries(appStorage.snapshot()).filter(([k]) => k.startsWith(`${loggedInUser}_ai_generation_`))
            .flatMap(([, value]) => { try { return [JSON.parse(value)]; } catch { return []; } })
            .filter(item => item.scope === scope).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    function render() {
        const enabled = active();
        const state = document.getElementById('ai-settings-state');
            if (state) state.textContent = enabled ? `Active • ${settings().provider === 'openai' ? 'ChatGPT / OpenAI' : 'Gemini'} • ${settings().model || 'Default model'}` : 'Off • summaries are hidden';
        for (const kind of ['portfolio', 'coin']) {
            const root = document.getElementById(`ai-${kind}`); if (!root) continue;
            root.hidden = !enabled; if (!enabled) continue;
            const history = records(scopeFor(kind)), latest = history.find(item => item.status === 'complete') || history[0], output = root.querySelector('.ai-output'), link = root.querySelector('.ai-saved');
            link.hidden = !latest; if (latest) link.href = '#ai=' + latest.id;
            output.textContent = latest ? latest.text || latest.error || (Date.now() - Date.parse(latest.createdAt) < 120000 ? 'Generating your overview…' : 'This overview did not finish. You can generate another.')
                : kind === 'coin' ? 'Review this crypto, its market data and your holdings.' : 'Review portfolio exposure, market movements and areas to watch.';
            root.querySelector('.ai-date').textContent = latest ? `${new Date(latest.createdAt).toLocaleString()} • ${latest.model}` : '';
            const status = root.querySelector('.ai-status');
            status.textContent = history[0]?.status === 'pending' ? (Date.now() - Date.parse(history[0].createdAt) < 120000 ? 'Generating your overview…' : 'The last attempt did not finish. Generate again to retry.') : history[0]?.status === 'error' ? history[0].error : '';
            if (kind === 'portfolio') {
                const expanded = appStorage.getItem(`${loggedInUser}_aiPortfolioExpanded`) === 'true';
                const collapse = root.querySelector('.ai-collapse');
                collapse.classList.toggle('collapsed', !expanded);
                collapse.inert = !expanded;
                root.querySelector('.ai-toggle').setAttribute('aria-expanded', String(expanded));
                root.querySelector('.arrow').classList.toggle('rotated', expanded);
            }
        }
        if (!enabled) document.getElementById('ai-saved-dialog')?.close();
    }
    async function api(body) {
        const owner = loggedInUser;
        const response = await CloudAccount.authorizedFetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let data;
        try { data = await response.json(); } catch { throw new Error(response.status === 504 ? 'The AI service took too long. Try a faster model in AI settings, then generate again.' : 'The AI service could not respond. Please try again shortly.'); }
        if (loggedInUser !== owner) throw new Error('Your account changed. Please generate again.');
        // Normally the server already saved the record. Only recover a completed result if its save failed.
        if (!response.ok && data.generation?.status === 'complete' && !data.reused) { appStorage.setItem(`${owner}_ai_generation_${data.generation.id}`, JSON.stringify(data.generation)); await CloudAccount.flush(); }
        if (!response.ok) throw new Error(data.error || 'AI is unavailable');
        return data;
    }
    async function generate(kind, daily = false) {
        if (busy || !active()) return;
        const owner = loggedInUser, scope = scopeFor(kind), root = document.getElementById(`ai-${kind}`), button = root.querySelector('.ai-generate');
        const coins = (users[loggedInUser]?.cryptos || []).filter(coin => scope === 'portfolio' || coin.id === scope).map(coin => {
            const price = getPriceFromObject(cryptoPrices[coin.id]) || null, holdings = getTotalActiveHoldings(coin.id);
            let news; try { news = JSON.parse(appStorage.getItem(`${loggedInUser}_freeNews_${coin.id.replace(/-/g, ' ').toLowerCase()}_${coin.symbol.toLowerCase()}`)); } catch {}
            return { name: coin.name || coin.id, symbol: coin.symbol, holdings, price, value: price === null ? null : holdings * price,
                change24h: cryptoPriceChanges[coin.id] ?? null, rsi: getStoredRSI(coin.id),
                chart: kind === 'coin' ? { candles: (storedOHLCDataPerCrypto[coin.id] || []).slice(-60) } : undefined,
                headlines: (news?.articles || []).filter(article => Number.isFinite(article.published_on) && Number.isFinite(new Date(article.published_on * 1000).getTime())).slice(0, 3).map(article => ({
                    title: article.title, source: article.source, publishedAt: new Date(article.published_on * 1000).toISOString() })) };
        });
        busy = true; button.disabled = true; button.textContent = 'Generating…'; root.querySelector('.ai-status').textContent = 'Reviewing your selected data…';
        try { await CloudAccount.flush(); await api({ action: daily && kind === 'portfolio' ? 'daily' : 'generate', context: { scope, currency: getCoinGeckoCurrency(), observedAt: new Date().toISOString(), coins } }); if (owner === loggedInUser) { await CloudAccount.refresh(); render(); } }
        catch (error) { if (owner === loggedInUser) root.querySelector('.ai-status').textContent = error.message; }
        finally { busy = false; button.disabled = false; button.textContent = 'Generate overview'; }
    }
    function checkDaily() {
        if (!CloudAccount.isReady || busy || !loggedInUser || !active() || document.hidden || !navigator.onLine) return;
        // Hydration already loaded today's shared marker; no provider/server request is needed.
        if (appStorage.getItem(`${loggedInUser}_ai_daily_${summaryDay()}`)) return;
        const coins = users[loggedInUser]?.cryptos || [];
        if (!coins.length || !coins.some(coin => getPriceFromObject(cryptoPrices[coin.id]) > 0)) return;
        const attempt = `${loggedInUser}:${summaryDay()}`;
        if (dailyAttempts.has(attempt)) return;
        dailyAttempts.add(attempt);
        // The server atomically reserves the day in Supabase before any provider call.
        generate('portfolio', true);
    }
    function configure() {
        let dialog = document.getElementById('ai-settings');
        if (!dialog) {
            dialog = node('dialog', null, 'ai-settings'); dialog.id = 'ai-settings'; dialog.append(node('h2', 'AI settings'));
            const providerLabel = node('label', 'Provider'), provider = node('select'); provider.id = 'ai-provider';
            for (const [value, text] of [['gemini', 'Gemini'], ['openai', 'ChatGPT / OpenAI API']]) { const option = node('option', text); option.value = value; provider.append(option); }
            providerLabel.append(provider); dialog.append(providerLabel);
            const keyLabel = node('label', 'API key'), input = node('input'); input.type = 'password'; input.autocomplete = 'off'; input.id = 'ai-key'; keyLabel.append(input); dialog.append(keyLabel);
            const modelLabel = node('label', 'Model'), model = node('select'); model.id = 'ai-model'; modelLabel.append(model); dialog.append(modelLabel);
            const resetModels = () => {
                model.replaceChildren(); const option = node('option', 'Load available models'); option.value = ''; model.append(option); model.disabled = true;
                if (settings().provider === provider.value && settings().model) { const saved = node('option', settings().model); saved.value = settings().model; model.append(saved); model.value = settings().model; model.disabled = false; }
            };
            provider.onchange = () => { input.value = settings().provider === provider.value ? settings().apiKey || '' : ''; resetModels(); };
            const loadModels = node('button', 'Load available models'); dialog.append(loadModels);
            dialog.append(node('p', 'Activation enables one automatic portfolio overview each day while the app is open, with a new day starting at 6am Brisbane time. Crypto overviews generate only when you click Generate. Summaries send balances, prices, indicators, available price candles and cached headlines to your provider. Login details, wallet addresses and other API keys are excluded. API usage may incur charges; a ChatGPT subscription is separate from API access.'));
            const status = node('p'); status.setAttribute('role', 'status'); dialog.append(status);
            loadModels.onclick = async () => {
                if (!input.value.trim()) { status.textContent = 'Enter an API key first.'; return; }
                loadModels.disabled = true; status.textContent = 'Loading models from your provider…';
                try {
                    const prior = settings();
                    const unchanged = prior.provider === provider.value && prior.apiKey === input.value.trim();
                    appStorage.setItem(key(), JSON.stringify({ provider: provider.value, apiKey: input.value.trim(), enabled: unchanged && prior.enabled === true,
                        ...(unchanged && prior.model ? { model: prior.model } : {}) }));
                    render(); await CloudAccount.flush();
                    const data = await api({ action: 'models' }); model.replaceChildren();
                    for (const item of data.models) { const option = node('option', item.name === item.id ? item.id : `${item.name} (${item.id})`); option.value = item.id; model.append(option); }
                    model.disabled = !data.models.length;
                    if (data.models.some(item => item.id === prior.model) && unchanged) model.value = prior.model;
                    status.textContent = data.models.length ? 'Choose a model, then activate AI. Pricing and limits depend on your provider.' : 'No compatible text models were returned.';
                } catch (error) { status.textContent = error.message; } finally { loadModels.disabled = false; }
            };
            const activate = node('button', 'Activate AI'); activate.onclick = async () => {
                if (!input.value.trim()) { status.textContent = 'Enter an API key first.'; return; }
                if (!model.value) { status.textContent = 'Load and select a model first.'; return; }
                activate.disabled = true; status.textContent = 'Checking your key…';
                try {
                    const next = { provider: provider.value, apiKey: input.value.trim(), model: model.value, enabled: false };
                    appStorage.setItem(key(), JSON.stringify(next)); render(); await CloudAccount.flush();
                    await api({ action: 'validate' }); appStorage.setItem(key(), JSON.stringify({ ...next, enabled: true }));
                    await CloudAccount.flush(); render(); dialog.close(); scheduleDaily();
                } catch (error) { status.textContent = error.message; } finally { activate.disabled = false; }
            };
            const disable = node('button', 'Disable AI'); disable.onclick = async () => {
                appStorage.setItem(key(), JSON.stringify({ ...settings(), enabled: false })); render();
                try { await CloudAccount.flush(); dialog.close(); } catch (error) { status.textContent = error.message; }
            };
            const close = node('button', 'Close'); close.onclick = () => dialog.close(); dialog.append(activate, disable, close); document.body.append(dialog);
        }
        dialog.querySelector('#ai-provider').value = settings().provider || 'gemini'; dialog.querySelector('input').value = settings().apiKey || '';
        dialog.querySelector('#ai-provider').dispatchEvent(new Event('change'));
        dialog.showModal();
    }
    function openSaved() {
        if (!active()) return;
        const id = location.hash.match(/^#ai=([0-9a-f-]{36})$/)?.[1]; if (!id) return;
        let item; try { item = JSON.parse(appStorage.getItem(`${loggedInUser}_ai_generation_${id}`)); } catch {} if (!item) return;
        let dialog = document.getElementById('ai-saved-dialog');
        if (!dialog) { dialog = node('dialog', null, 'ai-settings'); dialog.id = 'ai-saved-dialog'; document.body.append(dialog); }
        dialog.replaceChildren(node('h2', item.scope === 'portfolio' ? 'Portfolio overview' : item.scope + ' overview'), node('p', new Date(item.createdAt).toLocaleString()), node('div', item.text || item.error || 'Generating…', 'ai-output'));
        const close = node('button', 'Close'); close.onclick = () => dialog.close(); dialog.append(close); if (!dialog.open) dialog.showModal();
    }
    function install() {
        if (document.getElementById('ai-portfolio')) return;
        const section = node('section', null, 'settings-section'); section.append(node('h3', 'AI (Optional)', 'settings-section-title'));
        const card = node('div', null, 'settings-card'), row = node('div', null, 'settings-row'), state = node('span'); state.id = 'ai-settings-state';
        const configureButton = node('button', 'Configure AI', 'settings-save-btn'); configureButton.onclick = configure;
        row.append(state, configureButton); card.append(row); section.append(card); document.querySelector('#api-keys-page .settings-page-footer')?.before(section);
        for (const kind of ['portfolio', 'coin']) {
            const root = node('section', null, 'ai-overview'); root.id = `ai-${kind}`; root.hidden = true;
            const body = node('div', null, 'ai-body'), content = node('div', null, 'ai-inner'); body.append(content);
            const collapse = node('div', null, 'ai-collapse collapsed'); collapse.id = `ai-${kind}-body`;
            if (kind === 'portfolio') {
                const toggle = node('button', null, 'portfolio-stats-toggle ai-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-controls', collapse.id);
                toggle.append(node('span', '▶', 'arrow'), node('span', 'Portfolio AI overview', 'toggle-text'));
                toggle.onclick = () => { appStorage.setItem(`${loggedInUser}_aiPortfolioExpanded`, String(toggle.getAttribute('aria-expanded') !== 'true')); render(); };
                root.append(toggle);
            } else content.append(node('h3', 'Crypto AI overview'));
            content.append(node('p', null, 'ai-date'), node('div', null, 'ai-output'));
            const status = node('p', null, 'ai-status'); status.setAttribute('role', 'status'); content.append(status);
            if (kind === 'portfolio') { collapse.append(body); root.append(collapse); } else root.append(body);
            const actions = node('div', null, 'ai-actions'), generateButton = node('button', 'Generate overview', 'ai-generate'); generateButton.onclick = () => generate(kind);
            const permalink = node('a', 'Saved overview', 'ai-saved'); permalink.hidden = true; actions.append(generateButton, permalink); content.append(actions);
            content.append(node('p', (kind === 'portfolio' ? 'Daily refresh from 6am Brisbane time when the app is open. ' : 'Generated only on request. Uses available CoinGecko price candles, not TradingView drawings or the selected chart timeframe. ') + 'Educational analysis, not a prediction. API usage is billed by your provider.', 'ai-disclosure'));
            const target = document.getElementById(kind === 'portfolio' ? 'crypto-containers' : 'tradingview-chart-container');
            if (kind === 'portfolio') target?.before(root); else target?.after(root);
        }
        window.addEventListener('cloud-data-loaded', event => {
            if (event.detail?.keys?.some(key => key.startsWith(`${loggedInUser}_ai`))) render();
            scheduleDaily();
        }); window.addEventListener('hashchange', openSaved);
        window.addEventListener('app-ready', scheduleDaily);
        document.addEventListener('visibilitychange', scheduleDaily);
        setInterval(scheduleDaily, 30000);
        const name = document.getElementById('crypto-name'); if (name) new MutationObserver(render).observe(name, { childList: true, subtree: true });
        render(); openSaved(); scheduleDaily();
    }
    return { install, configure };
})();
