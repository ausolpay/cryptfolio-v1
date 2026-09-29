/* Enhance the existing alert forms without changing their saved keys or trigger rules. */
const PackageAlerts = (() => {
    function decorate(card, pkg) {
        card.className = 'package-rule-card';
        card.dataset.currency = pkg.paymentCurrency || 'BTC';
        card.dataset.name = pkg.name.toLowerCase();
        const intro = document.createElement('div'); intro.className = 'package-rule-meta';
        const raw = pkg.apiData?.currencyAlgoTicket || pkg.apiData;
        const currency = card.dataset.currency;
        const amount = pkg.isTeam ? Number(pkg.apiData?.minShareAmount ?? raw?.minShareAmount) : Number(raw?.price);
        intro.textContent = `${currency} wallet · ${Number.isFinite(amount) ? amount + ' ' + currency + (pkg.isTeam ? ' / share' : ' / package') : 'Live price unavailable'} · ${pkg.crypto} rewards`;
        card.prepend(intro);
        const automation = card.querySelectorAll('input[type="checkbox"]');
        for (const input of card.querySelectorAll('input')) {
            if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', `${pkg.name} ${input.id.replace(/^(team-)?(alert|autobuy|autoshares)-/, '').replaceAll('-', ' ')}`);
            if (input.type === 'number' && input.placeholder) input.placeholder = input.placeholder.split(' (')[0];
        }
        const shares = card.querySelector('input[id^="team-autobuy-shares-"]');
        if (shares) shares.addEventListener('change', () => {
            const count = Number(shares.value);
            if (!Number.isSafeInteger(count) || count < 1 || count > 9999) { shares.setCustomValidity('Enter a whole number from 1 to 9999.'); shares.reportValidity(); return; }
            shares.setCustomValidity('');
            const key = `${loggedInUser}_teamAutoBuy`, settings = JSON.parse(appStorage.getItem(key) || '{}');
            if (settings[pkg.name]) { settings[pkg.name].shares = count; appStorage.setItem(key, JSON.stringify(settings)); }
        });
        const summary = document.createElement('p'); summary.className = 'package-rule-state';
        const update = () => {
            const on = [...automation].some(input => input.checked);
            const rules = [...card.querySelectorAll('input[id^="alert-"], input[id^="team-alert-"]')].some(input => Number(input.value) > 0);
            const continuous = card.querySelector('input.team-autoshares-checkbox')?.checked;
            summary.textContent = on ? (continuous ? 'Auto-shares enabled · follows your saved target' : rules ? 'Automation enabled · uses saved thresholds' : 'Automation enabled · set and save alert thresholds for auto-buy') : 'Automation off · alerts only';
            card.dataset.automation = on ? 'on' : 'off';
        };
        card.addEventListener('change', update); update(); card.append(summary);
        // Preserve field edits while filtering; no catalogue reload is needed.
        applyCardFilter(card);
    }
    function applyCardFilter(card) {
        const currency = document.getElementById('alert-currency-filter')?.value || 'BTC';
        const search = document.getElementById('alert-package-search')?.value.trim().toLowerCase() || '';
        card.hidden = (currency !== 'ALL' && card.dataset.currency !== currency) || !card.dataset.name.includes(search);
    }
    function filter() { document.querySelectorAll('#package-alerts-page .package-rule-card').forEach(applyCardFilter); }
    return { decorate, filter };
})();
