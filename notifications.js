const AppNotifications = (() => {
    let lastRendered = '';
    const prefix = () => typeof loggedInUser === 'string' && loggedInUser ? `${loggedInUser}_notice_` : null;
    const readKey = id => `${prefix()}read_${id}`;
    function list() {
        const start = prefix();
        if (!start) return [];
        return Object.entries(appStorage.snapshot()).filter(([key]) => key.startsWith(start + 'item_'))
            .flatMap(([key, value]) => {
                try { const item = JSON.parse(value); return [{ ...item, id: key.slice((start + 'item_').length), read: appStorage.getItem(readKey(key.slice((start + 'item_').length))) === 'true' }]; }
                catch { return []; }
            }).sort((a, b) => b.day.localeCompare(a.day) || a.title.localeCompare(b.title));
    }
    async function add(title, body, category = 'app') {
        const start = prefix();
        if (!start) return;
        const day = new Date().toISOString().slice(0, 10);
        const item = { title: String(title).slice(0, 160), body: String(body).slice(0, 2000), category, day };
        // Identical events from two monitoring devices produce the same cloud record.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(item)));
        const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (start !== prefix()) return;
        appStorage.setItem(start + 'item_' + id, JSON.stringify(item));
        render();
    }
    function text(tag, value, className) {
        const el = document.createElement(tag); el.textContent = value;
        if (className) el.className = className;
        return el;
    }
    function render() {
        const items = list();
        const unread = items.filter(item => !item.read).length;
        for (const badge of document.querySelectorAll('[data-notice-count]')) {
            badge.textContent = unread > 99 ? '99+' : String(unread);
            badge.hidden = !unread;
        }
        const bell = document.getElementById('notification-bell');
        if (bell) { bell.hidden = !prefix(); bell.setAttribute('aria-label', `Notifications${unread ? `, ${unread} unread` : ''}`); }
        const content = document.getElementById('notification-list');
        if (!content) return;
        const fingerprint = JSON.stringify([prefix(), items]);
        if (fingerprint === lastRendered) return;
        lastRendered = fingerprint;
        content.replaceChildren();
        if (!items.length) { content.append(text('p', 'You’re all caught up. Portfolio alerts, milestones and mining updates will appear here.', 'notice-empty')); return; }
        for (const item of items.slice(0, 100)) {
            const row = document.createElement('article'); row.className = 'notice-item' + (item.read ? '' : ' unread');
            row.append(text('small', `${item.category} · ${item.day}`), text('h3', item.title), text('p', item.body));
            if (!item.read) {
                const button = text('button', 'Mark read');
                button.onclick = () => { appStorage.setItem(readKey(item.id), 'true'); render(); };
                row.append(button);
            }
            content.append(row);
        }
    }
    function open() {
        render();
        const dialog = document.getElementById('notification-dialog');
        document.body.append(dialog);
        dialog.showModal();
    }
    function readAll() { for (const item of list()) appStorage.setItem(readKey(item.id), 'true'); render(); }
    window.addEventListener('cloud-data-loaded', render);
    window.addEventListener('app-data-changed', () => {
        if (!AppNotifications.scheduled) {
            AppNotifications.scheduled = true;
            setTimeout(() => { AppNotifications.scheduled = false; render(); }, 400);
        }
    });
    return { add, open, readAll, render };
})();
