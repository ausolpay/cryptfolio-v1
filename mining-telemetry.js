/* Display reported NiceHash samples, never simulated attempts or reward odds. */
function miningTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    const timestamp = Number.isFinite(number) ? (number < 1e11 ? number * 1000 : number) : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function buildMiningTelemetry(pkg, dataPoints, width, now = Date.now()) {
    const points = dataPoints.filter(p => Number.isFinite(p.bestSharePercent) && p.bestSharePercent >= 0 && miningTimestamp(p.timestamp))
        .map(p => ({ value: p.bestSharePercent, timestamp: miningTimestamp(p.timestamp) })).sort((a, b) => a.timestamp - b.timestamp);
    const percent = EasyMiningModel.bestSharePercent(pkg);
    const updated = miningTimestamp(pkg.fullOrderData?.updatedTs);
    // Without a server timestamp, use the last observation rather than inventing a new update each second.
    if (percent !== null && (!points.length || points[points.length - 1].value !== percent)) {
        points.push({ value: percent, timestamp: Math.max(updated || now, points[points.length - 1]?.timestamp || 0) });
    }
    const rewards = (Array.isArray(pkg.fullOrderData?.soloReward) ? pkg.fullOrderData.soloReward : [])
        .map(r => miningTimestamp(r.createdTs ?? r.timestamp ?? r.time ?? r.ts)).filter(Boolean);
    const start = miningTimestamp(pkg.startTime) || points[0]?.timestamp || now;
    const duration = Number(pkg.packageDuration) > 0 ? Number(pkg.packageDuration) * 1000 : 3600000;
    const end = Math.max(miningTimestamp(pkg.endTime) || start + duration, start + 1000, points[points.length - 1]?.timestamp || 0, ...rewards);
    const from = Math.min(start, points[0]?.timestamp || start, ...rewards);
    const count = Math.max(8, Math.min(100, Math.floor((width - 56) / 12)));
    const interval = (end - from) / count;
    const bins = Array.from({ length: count }, (_, i) => ({ timestamp: from + i * interval, value: null, samples: 0, rewards: 0 }));
    const binIndex = timestamp => Math.max(0, Math.min(count - 1, Math.floor((timestamp - from) / interval)));
    for (const point of points) {
        const bin = bins[binIndex(point.timestamp)];
        bin.value = Math.max(bin.value ?? 0, point.value);
        bin.samples++;
    }
    for (const timestamp of rewards) bins[binIndex(timestamp)].rewards++;
    return { bins, from, end, interval, percent, latest: points[points.length - 1], ceiling: Math.max(120, ...points.map(p => p.value)) };
}

function installMiningTelemetry() {
    let chartSignature = '', observedChart = null;
    const observations = new Map();
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const share = value => value === null ? 'Not reported' : `${value.toFixed(1)}%`;
    function renderStatus(pkg) {
        const container = document.getElementById('mining-dice-container');
        const section = document.getElementById('mining-dice-section');
        if (!container || !section) return;
        section.classList.add('telemetry-status-section');
        section.style.display = '';
        container.className = 'telemetry-status';
        const coins = [pkg.mainCrypto || pkg.crypto, pkg.cryptoSecondary || pkg.mergeCrypto].filter(Boolean).join(' / ');
        const markup = `<div class="telemetry-status-heading"><span class="telemetry-beacon${pkg.active ? ' live' : ''}"></span><strong>${escape(coins || 'Package')} · ${pkg.active ? 'Mining' : 'Completed'}</strong></div>
            <div class="telemetry-status-metrics"><div><span>Best reported share</span><strong>${share(EasyMiningModel.bestSharePercent(pkg))}</strong></div><div><span>Reported blocks</span><strong>🚀 ${Number(pkg.totalBlocks) || 0}</strong></div></div>`;
        if (container.dataset.markup !== markup || !container.children.length) { container.innerHTML = markup; container.dataset.markup = markup; }
        section.querySelector('.dice-block-counter')?.setAttribute('hidden', '');
        section.querySelector('.telemetry-dice-caption')?.remove();
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
        if (currentDetailPackage && observedChart?.getBoundingClientRect().width) render(currentDetailPackage);
    }) : null;
    function render(pkg) {
        if (!pkg) return;
        currentDetailPackage = pkg;
        lastDisplayedBlockCount = Number(pkg.totalBlocks) || 0;
        const percent = EasyMiningModel.bestSharePercent(pkg);
        const fill = document.getElementById('close-to-reward-fill');
        const label = document.getElementById('close-to-reward-percentage');
        if (fill) fill.style.width = `${Math.min(100, percent ?? 0)}%`;
        if (label) { label.textContent = share(percent); label.style.left = `${Math.max(10, Math.min(95, percent ?? 0))}%`; }
        document.getElementById('close-to-reward-icon')?.classList.toggle('found', lastDisplayedBlockCount > 0);
        const chart = document.getElementById('package-detail-page-blocks');
        if (!chart) return;
        chart.classList.add('telemetry-chart');
        if (observedChart !== chart) { observer?.disconnect(); observedChart = chart; observer?.observe(chart); }
        const width = Math.max(180, Math.round(chart.getBoundingClientRect().width || 600));
        const stored = miningChartDataStore[pkg.id];
        const dataPoints = [...(stored?.dataPoints || [])];
        const last = dataPoints.filter(p => Number.isFinite(p.bestSharePercent)).at(-1);
        if (percent !== null && last?.bestSharePercent !== percent) {
            const previous = observations.get(pkg.id);
            const observation = previous?.bestSharePercent === percent ? previous : {
                bestSharePercent: percent, timestamp: miningTimestamp(pkg.fullOrderData?.updatedTs) || Date.now()
            };
            observations.set(pkg.id, observation);
            dataPoints.push(observation);
        }
        const model = buildMiningTelemetry(pkg, dataPoints, width);
        const signature = JSON.stringify([pkg.id, pkg.active, width, model.bins, model.ceiling]);
        const step = (width - 56) / model.bins.length;
        const y = value => 222 - value / model.ceiling * 170;
        const x = timestamp => 36 + (timestamp - model.from) / (model.end - model.from) * (width - 56);
        const intervalText = model.interval < 60000 ? `${(model.interval / 1000).toFixed(1).replace(/\.0$/, '')}s` : `${(model.interval / 60000).toFixed(1).replace(/\.0$/, '')}m`;
        if (signature !== chartSignature || !chart.querySelector('svg')) {
            const oldSvg = chart.querySelector('svg');
            const svgMarkup = `<svg viewBox="0 0 ${width} 256" role="img" aria-label="Reported best-share samples over package time. Dashed line is the 100 percent block target.">
                <line x1="36" y1="${y(100)}" x2="${width - 20}" y2="${y(100)}" class="telemetry-threshold"/>
                <text x="36" y="22" class="telemetry-axis">100% block target</text>
                <text x="6" y="224" class="telemetry-axis">0%</text>
                ${model.bins.map((bin, i) => `<g><rect class="telemetry-bar${bin.rewards ? ' rewarded' : ''}" x="${36 + i * step + 1}" y="${bin.value === null ? 220 : y(bin.value)}" width="${Math.max(2, step - 3)}" height="${bin.value === null ? 2 : Math.max(2, 222 - y(bin.value))}" opacity="${bin.value === null ? 0.15 : 1}"><title>${time(bin.timestamp)} · ${bin.samples ? `${share(bin.value)} best share · ${bin.samples} observation(s)` : 'No share observations'}${bin.rewards ? ` · ${bin.rewards} confirmed reward(s)` : ''}</title></rect>${bin.rewards ? `<text x="${36 + (i + .5) * step}" y="${Math.max(27, y(bin.value ?? 100) - 12)}" text-anchor="middle" class="telemetry-rocket"><title>${bin.rewards} confirmed reward(s) · ${time(bin.timestamp)}</title>🚀</text>` : ''}</g>`).join('')}
                ${model.latest ? `<circle cx="${x(model.latest.timestamp)}" cy="${y(model.latest.value)}" r="4" class="telemetry-dot${pkg.active ? ' live' : ''}"/>` : ''}
                <text x="36" y="249" class="telemetry-axis">${time(model.from)}</text>
                ${width > 420 ? `<text x="${width / 2}" y="249" text-anchor="middle" class="telemetry-axis">${time((model.from + model.end) / 2)}</text>` : ''}
                <text x="${width - 20}" y="249" text-anchor="end" class="telemetry-axis">${time(model.end)}</text>
                </svg>`;
            // Preserve bar nodes between polls so changed measurements transition instead of restarting every second.
            const template = document.createElement('template'); template.innerHTML = svgMarkup;
            const nextSvg = template.content.firstElementChild;
            const animations = [];
            if (oldSvg && chart.dataset.layout === `${pkg.id}:${width}:${model.bins.length}`) {
                const oldBars = oldSvg.querySelectorAll('rect'), nextBars = nextSvg.querySelectorAll('rect');
                nextBars.forEach((bar, i) => {
                    const old = oldBars[i];
                    const from = { y: `${old.getAttribute('y')}px`, height: `${old.getAttribute('height')}px` };
                    const to = { y: `${bar.getAttribute('y')}px`, height: `${bar.getAttribute('height')}px` };
                    for (const attr of bar.attributes) old.setAttribute(attr.name, attr.value);
                    old.innerHTML = bar.innerHTML; bar.replaceWith(old);
                    if (from.height !== to.height || from.y !== to.y) animations.push({ bar: old, from, to });
                });
            }
            chart.replaceChildren(nextSvg);
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                for (const { bar, from, to } of animations) bar.animate?.([from, to], { duration:650, easing:'ease-out' });
            }
            chart.dataset.layout = `${pkg.id}:${width}:${model.bins.length}`;
            chartSignature = signature;
        }
        let note = chart.querySelector('.telemetry-note');
        if (!note) { note = document.createElement('p'); note.className = 'telemetry-note'; chart.append(note); }
        const age = model.latest ? Math.max(0, Math.floor((Date.now() - model.latest.timestamp) / 1000)) : null;
        const freshness = !pkg.active ? 'Completed package' : age === null ? 'Waiting for share data' : age > 30 ? `Last observation ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago` : 'Receiving share observations';
        note.textContent = `${freshness} · ${intervalText} per bar. Bars show the highest reported share in each interval, not individual attempts or reward odds.`;
        const timeline = document.getElementById('mining-chart-timeline');
        if (timeline) timeline.textContent = '';
        renderStatus(pkg);
        if (stored) updateLiveMetricsGraphs(pkg, stored);
    }
    window.updateMiningProgressChart = render;
    window.updateMiningChartLive = pkg => {
        if (currentDetailPackage?.id !== pkg.id) return;
        collectChartDataPoint(pkg);
        saveChartDataToStorage();
        pkg.localRemainingMs = Math.max(0, Number(pkg.estimateDurationInSeconds) * 1000 || (miningTimestamp(pkg.endTime) || Date.now()) - Date.now());
        render(pkg);
    };
    // The legacy timer inferred share quality from elapsed time. Keep only its countdown behavior.
    window.updatePackageDetailLive = () => {
        const pkg = currentDetailPackage;
        if (!pkg) return;
        pkg.localRemainingMs = Math.max(0, (pkg.localRemainingMs || 0) - 1000);
        const seconds = Math.floor(pkg.localRemainingMs / 1000);
        const countdown = document.getElementById('mining-countdown');
        if (countdown) countdown.textContent = pkg.active
            ? [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(v => String(v).padStart(2, '0')).join(':') : 'Completed';
        render(pkg);
    };
    window.initDiceSection = renderStatus;
    window.syncDiceWithPolling = renderStatus;
    window.calculateCloseToRewardPercent = pkg => EasyMiningModel.bestSharePercent(pkg) ?? 0;
}
if (typeof module !== 'undefined') module.exports = { buildMiningTelemetry, miningTimestamp };
