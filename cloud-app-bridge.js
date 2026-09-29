/* Connect cloud changes to existing app views without resetting the current page. */
function installCloudAppBridge() {
    installMiningTelemetry();
    const automatic = ['executeAutoBuySolo', 'executeAutoBuyTeam', 'executeAutoSharesTeam',
        'executeAutoSharesOnAlertTeam', 'autoUpdateCryptoHoldings', 'autoAddCryptoBoxesForActivePackages',
        'autoClearTeamShares'];
    const manual = ['buySoloPackage', 'buyTeamPackageUpdated', 'buyPackage', 'buyTeamPackage',
        'reAddTeamShares', 'buyPackageFromPage', 'callNiceHashWithdrawal', 'fetchNiceHashDepositAddress'];
    for (const name of [...automatic, ...manual]) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        window[name] = async function (...args) {
            // The team dispatcher delegates to the guarded team purchase function.
            if (name === 'buyPackageFromPage' && args[0]?.isTeam) return original.apply(this, args);
            try { return await CloudAccount.runAutomation(() => original.apply(this, args), manual.includes(name) || name === 'autoClearTeamShares'); }
            catch (error) {
                console.error('Cloud automation paused:', error.message);
                if (name === 'autoClearTeamShares' || name === 'reAddTeamShares') throw error;
                if (manual.includes(name)) showModal(error.message);
            }
        };
    }
    window.addEventListener('cloud-data-loaded', ({ detail: { keys } }) => {
        if (!loggedInUser) return;
        users = JSON.parse(appStorage.getItem('users') || '{}');
        if (keys.includes(`${loggedInUser}_easyMiningSettings`)) {
            easyMiningSettings = JSON.parse(appStorage.getItem(`${loggedInUser}_easyMiningSettings`) || '{}');
            if (easyMiningSettings.enabled && easyMiningSettings.apiKey) startEasyMiningPolling();
        }
        if (keys.includes(`${loggedInUser}_coinGeckoApiSettings`)) apiKeys = loadUserApiKeys();
        isHoldingsVibrateEnabled = appStorage.getItem('isHoldingsVibrateEnabled') === 'true';
        isEasyMiningVibrateEnabled = appStorage.getItem('isEasyMiningVibrateEnabled') === 'true';
        for (const [id, key] of [
            ['holdings-vibrate', 'isHoldingsVibrateEnabled'], ['easymining-vibrate', 'isEasyMiningVibrateEnabled'],
            ['holdings-audio', 'isHoldingsAudioEnabled'], ['easymining-audio', 'isEasyMiningAudioEnabled']
        ]) {
            const control = document.getElementById(`${id}-toggle`);
            if (control && keys.includes(key)) {
                control.checked = appStorage.getItem(key) === 'true';
                control.dispatchEvent(new Event('change'));
            }
        }
        if (keys.includes('theme')) {
            const control = document.getElementById('dark-mode-toggle');
            if (control) { control.checked = appStorage.getItem('theme') !== 'light'; control.dispatchEvent(new Event('change')); }
        }
        if (keys.some(key => /(?:PackageAlerts|AutoBuy|AutoShares|AutoSharesOnAlert)$/.test(key)) &&
            !document.activeElement?.matches('input, textarea, select')) {
            if (document.getElementById('solo-alerts-list')?.offsetParent) loadSoloAlerts();
            if (document.getElementById('team-alerts-list')?.offsetParent) loadTeamAlerts();
        }
        const validIds = new Set((users[loggedInUser]?.cryptos || []).map(coin => coin.id));
        document.querySelectorAll('#crypto-containers > [id$="-container"]').forEach(element => {
            if (!validIds.has(element.id.replace(/-container$/, ''))) element.remove();
        });
        loadUserData();
        syncAllHoldingsFromEntries();
        updateTotalHoldings();
        updateStripPnL();
        updateNavProfileIcon();
        // Keep edits in progress intact; refresh lists and labels without rebuilding forms.
        if (currentCryptoId && !document.activeElement?.matches('input, textarea, select')) {
            displayHoldingsEntries(currentCryptoId);
            displayHistoryEntries(currentCryptoId);
            updateModalHoldings(currentCryptoId);
        }
        if (!document.activeElement?.matches('input, textarea, select')) {
            syncSettingsPageToggles();
            if (document.getElementById('account-settings-page')?.style.display === 'block') loadAccountSettings();
        }
    });
}
