/* Actual NiceHash best-share telemetry. Never infer reward proximity from elapsed time. */
function installMiningTelemetry() {
    let lastDiceState = '';
    function renderDice(pkg) {
        const container = document.getElementById('mining-dice-container');
        const section = document.getElementById('mining-dice-section');
        if (!container || !section) return;
        section.style.display = '';
        const percent = EasyMiningModel.bestSharePercent(pkg);
        const blocks = Number(pkg.totalBlocks) || 0;
        const state = JSON.stringify([pkg.id, percent, blocks, pkg.active]);
        if (state === lastDiceState && container.children.length) return;
        lastDiceState = state;
        container.replaceChildren();
        container.classList.add('telemetry-dice-container');
        const coinNames = [pkg.crypto, pkg.cryptoSecondary].filter(Boolean);
        for (const coin of coinNames) {
            const cube = document.createElement('div');
            cube.className = 'telemetry-die' + (pkg.active ? ' running' : '') + (blocks ? ' rewarded' : '');
            cube.setAttribute('role', 'img');
            cube.setAttribute('aria-label', `${coin}: ${blocks} reported blocks. Best share ${percent === null ? 'not reported' : percent + '%'}.`);
            for (const [index, value] of [coin, percent === null ? '—' : percent.toFixed(0) + '%', 'NiceHash', coin, blocks + ' 🚀', pkg.active ? 'LIVE' : 'DONE'].entries()) {
                const face = document.createElement('span');
                face.className = `telemetry-face face-${index}`; face.textContent = value; cube.append(face);
            }
            container.append(cube);
        }
        updateDiceBlockCounter(blocks, false);
        const viewport = document.getElementById('mining-dice-viewport');
        let caption = section.querySelector('.telemetry-dice-caption');
        if (!caption) { caption = document.createElement('p'); caption.className = 'telemetry-dice-caption'; viewport.after(caption); }
        caption.textContent = 'Animated mining status • rotations are not individual hash attempts.';
    }
    function render(pkg) {
        if (!pkg) return;
        currentDetailPackage = pkg;
        lastDisplayedBlockCount = Number(pkg.totalBlocks) || 0;
        const percent = EasyMiningModel.bestSharePercent(pkg);
        const fill = document.getElementById('close-to-reward-fill');
        const label = document.getElementById('close-to-reward-percentage');
        if (fill) fill.style.width = `${Math.min(100, percent ?? 0)}%`;
        if (label) { label.textContent = percent === null ? 'Not reported' : `${percent.toFixed(1)}%`; label.style.left = `${Math.max(10, Math.min(95, percent ?? 0))}%`; }
        const icon = document.getElementById('close-to-reward-icon');
        if (icon) icon.classList.toggle('found', lastDisplayedBlockCount > 0);
        const chart = document.getElementById('package-detail-page-blocks');
        if (!chart) return;
        chart.classList.add('telemetry-chart');
        const stored = miningChartDataStore[pkg.id];
        const samples = (stored?.dataPoints || []).filter(point => typeof point.bestSharePercent === 'number' && Number.isFinite(point.bestSharePercent));
        const points = samples.slice(-150).map(point => ({ value: point.bestSharePercent, timestamp: point.timestamp }));
        if (percent !== null && (!points.length || points[points.length - 1].value !== percent)) {
            points.push({ value: percent, timestamp: Number(pkg.fullOrderData?.updatedTs) || Date.now() });
        }
        const ceiling = Math.max(120, ...points.map(point => point.value));
        const y = value => 220 - Math.min(ceiling, value) / ceiling * 190;
        const x = index => points.length < 2 ? 690 : 40 + index / (points.length - 1) * 650;
        const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
        const last = points[points.length - 1];
        chart.innerHTML = `<svg viewBox="0 0 760 250" role="img" aria-label="Best share reported by NiceHash; block target at 100 percent">
            <line x1="30" y1="${y(100)}" x2="720" y2="${y(100)}" class="telemetry-threshold"/>
            <text x="32" y="${y(100)-8}" class="telemetry-axis">100% block target</text>
            <path d="${path}" class="telemetry-line"/>
            ${last ? `<circle cx="${x(points.length-1)}" cy="${y(last.value)}" r="5" class="telemetry-dot"/>
            <text x="${x(points.length-1)}" y="${Math.max(20,y(last.value)-14)}" text-anchor="middle" class="telemetry-rocket${pkg.active ? ' live' : ''}">🚀</text>` : ''}
            <text x="32" y="242" class="telemetry-axis">Observed best-share history</text>
            </svg>`;
        const note = document.createElement('p'); note.className = 'telemetry-note';
        note.textContent = percent === null ? 'NiceHash has not reported a best-share value for this package.' :
            `${percent.toFixed(1)}% best reported share · ${lastDisplayedBlockCount} reported block(s). ${points.length < 2 ? 'Earlier share history is unavailable. ' : ''}This is share quality, not the chance of the next reward.`;
        chart.append(note);
        const timeline = document.getElementById('mining-chart-timeline');
        if (timeline) timeline.textContent = points.length > 1 ? `${new Date(points[0].timestamp).toLocaleTimeString()} — ${new Date(points[points.length-1].timestamp).toLocaleTimeString()}` : '';
        renderDice(pkg);
        if (stored) updateLiveMetricsGraphs(pkg, stored);
    }
    window.updateMiningProgressChart = render;
    window.updateMiningChartLive = pkg => { if (currentDetailPackage?.id === pkg.id) render(pkg); };
    window.initDiceSection = renderDice;
    window.syncDiceWithPolling = renderDice;
    window.calculateCloseToRewardPercent = pkg => EasyMiningModel.bestSharePercent(pkg) ?? 0;
}
