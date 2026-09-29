/* Website navigation shares the cloud login; no local portfolio or password store. */
(() => {
    const client = supabase.createClient('https://mpoaaemubklcrjaolpon.supabase.co',
        'sb_publishable_RnZO2mzbt8QXwza8pHSllA_CX2PYBux', { auth: { storage: window.CryptfolioAuthStorage } });
    client.auth.getSession().then(({ data }) => {
        window.websiteSession = data.session;
        if (typeof updateNavAuthState === 'function') updateNavAuthState();
    });
    window.toggleMobileMenu ||= () => document.getElementById('mobile-menu')?.classList.toggle('show');
    window.closeMobileMenu ||= () => document.getElementById('mobile-menu')?.classList.remove('show');
    window.toggleProfileDropdown ||= () => {
        const menu = document.getElementById('profile-dropdown-menu');
        if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    };
})();
