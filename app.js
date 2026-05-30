'use strict';

/* ═══════════════════════════════════════════════════════════
   HoaxBook — App Controller (app.js)
   UI interactions, D3 network visualization, simulation flow
   ═══════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────
const COLORS = { S: '#ffffff', E: '#9ca3af', I: '#ef4444', R: '#3b82f6' };
const LABEL = { S: 'Susceptible', E: 'Exposed', I: 'Percaya', R: 'Tidak Percaya' };
const POSTER_L = { ordinary: 'Orang Biasa', creator: 'Content Creator', media: 'Media', influencer: 'Influencer' };
let SIM_DAYS = 40;

// ── Application State ──────────────────────────────────────
let params = {
    posterType: 'ordinary',
    platform: 'facebook',
    posterMuFollower: 30, posterSdFollower: 6,
    muFollower: 30, sdFollower: 6,
    fypCategory: 'fyp',
    intelligenceCategory: 'bodoh',
    N: 150, sigma: 0.25, gamma: 0.67,
    duration: 15,
    simDays: 40,
    runs: 5,
};

const FOLLOWER_MAP = {
    influencer: { facebook: 500, instagram: 10000, tiktok: 50000 },
    creator: { facebook: 200, instagram: 1500, tiktok: 20000 },
    media: { facebook: 100, instagram: 1000, tiktok: 10000 },
    ordinary: { facebook: 30, instagram: 200, tiktok: 500 }
};

let lastResult = null;
let lastPostData = null;
let networkSim = null;   // D3 force simulation instance
let nodeEls = null;   // D3 selection of circle nodes
let linkEls = null;   // D3 selection of link lines
let isSimRunning = false; // Guard: prevent closing sim modal while running

// ── Utilities ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => Number(v).toLocaleString('id');
const pct = (v, n) => n ? (v / n * 100).toFixed(1) + '%' : '0%';

// ── Modal Management ───────────────────────────────────────
function openModal(id) {
    $(id).style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    // Prevent closing the simulation modal while simulation is running
    if (id === 'simModal' && isSimRunning) return;
    $(id).style.display = 'none';
    document.body.style.overflow = '';
}

// ── Parameter Management ───────────────────────────────────
function saveParams() {
    const fCat = $('pFypCat').value;
    const iCat = $('pIntCat').value;
    const pType = $('pPosterType').value;
    const pPlat = $('pPlatform').value;
    
    const posterMu = FOLLOWER_MAP[pType][pPlat];
    const posterSd = Math.round(posterMu * 0.2);

    const agentMu = FOLLOWER_MAP['ordinary'][pPlat];
    const agentSd = Math.round(agentMu * 0.2);

    params = {
        posterType: pType,
        platform: pPlat,
        posterMuFollower: posterMu,
        posterSdFollower: posterSd,
        muFollower: agentMu,
        sdFollower: agentSd,
        fypCategory: fCat,
        intelligenceCategory: iCat,
        N: parseInt($('pN').value),
        sigma: parseFloat($('pSigmaEI').value),
        gamma: parseFloat($('pGamma').value),
        duration: parseInt($('pDuration').value),
        simDays: parseInt($('pSimDays').value),
        runs: parseInt($('pRuns').value),
    };
    SIM_DAYS = params.simDays;
    updateParamSummary();
    closeModal('paramsModal');
}

function updateParamSummary() {
    $('ps-poster').textContent = SimEngine.ACCOUNT_CATEGORIES[params.posterType]?.label || '—';
    $('ps-platform').textContent = params.platform.charAt(0).toUpperCase() + params.platform.slice(1);
    $('ps-fyp').textContent = SimEngine.FYP_CATEGORIES[params.fypCategory]?.label || '—';
    $('ps-int').textContent = SimEngine.INTELLIGENCE_CATEGORIES[params.intelligenceCategory]?.label || '—';
    $('ps-n').textContent = params.N;
    $('ps-duration').textContent = params.duration + ' detik';
    $('ps-simdays').textContent = params.simDays + ' hari';
    $('ps-runs').textContent = params.runs + ' kali';

}

// ── Image Upload ───────────────────────────────────────────
function setupImageUpload() {
    $('postImage').addEventListener('change', function () {
        if (!this.files || !this.files[0]) return;
        const reader = new FileReader();
        reader.onload = e => {
            $('imgPreview').src = e.target.result;
            $('imgPreview').style.display = 'block';
            $('imgPlaceholder').style.display = 'none';
            $('imgRemove').style.display = 'flex';
        };
        reader.readAsDataURL(this.files[0]);
    });
}

function removeImage() {
    $('postImage').value = '';
    $('imgPreview').style.display = 'none';
    $('imgPreview').src = '';
    $('imgPlaceholder').style.display = 'flex';
    $('imgRemove').style.display = 'none';
}

// ── Tag Helper ─────────────────────────────────────────────
function appendTag(tag) {
    const ta = $('postCaption');
    ta.value = (ta.value ? ta.value + '\n' : '') + tag;
    ta.focus();
}

// ── Post Submission ────────────────────────────────────────
function submitPost() {
    const caption = $('postCaption').value.trim();
    if (!caption) { alert('Tulis konten hoax terlebih dahulu!'); return; }

    const img = $('imgPreview');
    lastPostData = {
        caption,
        imageData: img.style.display !== 'none' ? img.src : null,
        timestamp: new Date(),
    };
    closeModal('postModal');
    runAnimatedSimulation();
}

/* ═══════════════════════════════════════════════════════════
   SIMULATION RUNNER  — animated step-through
   ═══════════════════════════════════════════════════════════ */
async function runAnimatedSimulation() {
    const config = {
        N: params.N,
        muFollower: params.muFollower,
        sdFollower: params.sdFollower,
        posterMuFollower: params.posterMuFollower,
        posterSdFollower: params.posterSdFollower,
        posterType: params.posterType,
        fypCategory: params.fypCategory,
        intelligenceCategory: params.intelligenceCategory,
        sigma: params.sigma,
        gamma: params.gamma,
        T: params.simDays,
        I0: 1,
    };

    // ── Run Monte Carlo simulation ──
    const mcResult = SimEngine.runMonteCarlo(config, params.runs);
    const result = mcResult.lastResult;
    lastResult = result;

    // Build averaged timeline for result charts
    const avgTimeline = Array.from({ length: result.timeline.length }, (_, t) => ({
        S: mcResult.avg.S[t] ?? result.timeline[t]?.S ?? 0,
        E: mcResult.avg.E[t] ?? result.timeline[t]?.E ?? 0,
        I: mcResult.avg.I[t] ?? result.timeline[t]?.I ?? 0,
        R: mcResult.avg.R[t] ?? result.timeline[t]?.R ?? 0,
    }));
    result._avgTimeline = avgTimeline;

    // Sort agents by infectedDay (earliest first, never-infected last)
    const sorted = [...result.agents].sort((a, b) => {
        if (a.infectedDay === -1 && b.infectedDay === -1) return 0;
        if (a.infectedDay === -1) return 1;
        if (b.infectedDay === -1) return -1;
        return a.infectedDay - b.infectedDay;
    });

    // ── Open simulation modal & lock it ──
    isSimRunning = true;
    openModal('simModal');

    // Params recap
    const posterAgent = result.agents.find(a => a.infectedDay === 0);
    $('spr-poster').textContent = SimEngine.ACCOUNT_CATEGORIES[config.posterType]?.label || '—';
    $('spr-platform').textContent = params.platform.charAt(0).toUpperCase() + params.platform.slice(1);
    $('spr-conn').textContent = fmt(posterAgent ? posterAgent.followers : config.posterMuFollower);
    $('spr-fyp').textContent = (result.sampledValues.fypRate * 100).toFixed(0) + '%';
    $('spr-verdict').textContent = 'Menghitung...';

    // Wait for modal to render, then init network
    await sleep(120);
    initNetwork(result.agents);

    // ── Animate through timeline ──
    const T = result.timeline.length - 1;
    const durMs = params.duration * 1000;
    const stepMs = durMs / T;
    let remaining = params.duration;

    $('simTimer').textContent = remaining + 's';
    const timerIv = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        $('simTimer').textContent = remaining + 's';
    }, 1000);

    for (let t = 0; t <= T; t++) {
        const snap = result.timeline[t];

        // Progress
        $('spaFill').style.width = ((t / T) * 100).toFixed(0) + '%';
        $('spaStep').textContent = `Hari ke-${t} / ${T}`;

        // Assign per-agent visual status for this day (exact history)
        for (const a of result.agents) {
            a._viz = a.history[t];
        }

        // Update D3 network colours
        updateNetworkColors(result.agents);

        // Legend counters (sim modal)
        $('sl-sn').textContent = snap.S;
        $('sl-en').textContent = snap.E;
        $('sl-in').textContent = snap.I;
        $('sl-rn').textContent = snap.R;

        // Update live engagement metrics during simulation
        if (result.hourlyEvaluations[t]) {
            const evalT = result.hourlyEvaluations[t];
            $('spr-verdict').textContent = evalT.verdict;
        }

        // Mini chart
        drawMiniChart(result.timeline, t);

        if (t < T) await sleep(stepMs);
    }

    clearInterval(timerIv);
    $('simTimer').textContent = '✓';

    // ── Unlock simulation modal ──
    isSimRunning = false;

    await sleep(900);
    closeModal('simModal');
    showResults(result, config, result._avgTimeline);
}



/* ═══════════════════════════════════════════════════════════
   D3 — FORCE-DIRECTED NETWORK
   ═══════════════════════════════════════════════════════════ */
function initNetwork(agents) {
    const svgEl = $('networkSvg');
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const { width: W, height: H } = svgEl.getBoundingClientRect();
    const N = agents.length;

    // ── Nodes ──
    const nodes = agents.map(a => ({
        id: a.id,
        r: Math.max(3, Math.min(9, 2.5 + Math.sqrt(a.followers / 200))),
    }));

    // ── Random sparse links (~2 per node, capped) ──
    const links = [];
    const seen = new Set();
    const maxLinks = Math.min(N * 2, 600);
    for (let i = 0; i < maxLinks * 2 && links.length < maxLinks; i++) {
        const s = Math.floor(Math.random() * N);
        const t = Math.floor(Math.random() * N);
        if (s === t) continue;
        const key = Math.min(s, t) + ':' + Math.max(s, t);
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: s, target: t });
    }

    // ── Force simulation ──
    if (networkSim) networkSim.stop();
    networkSim = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(28).strength(0.25))
        .force('charge', d3.forceManyBody().strength(-14))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide().radius(d => d.r + 1));

    // ── Draw links ──
    linkEls = svg.append('g')
        .selectAll('line').data(links).join('line')
        .attr('class', 'link')
        .attr('stroke', 'rgba(255,255,255,.04)')
        .attr('stroke-width', 0.7);

    // ── Draw nodes ──
    nodeEls = svg.append('g')
        .selectAll('circle').data(nodes).join('circle')
        .attr('r', d => d.r)
        .attr('fill', COLORS.S)
        .attr('stroke', '#d1d5db')
        .attr('stroke-width', 1.5)
        .style('transition', 'fill .25s, r .25s, stroke .25s');

    // ── Tick ──
    networkSim.on('tick', () => {
        linkEls
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeEls
            .attr('cx', d => Math.max(d.r + 2, Math.min(W - d.r - 2, d.x)))
            .attr('cy', d => Math.max(d.r + 2, Math.min(H - d.r - 2, d.y)));
    });

    // Warm-up: settle the layout before animation begins
    networkSim.alpha(1);
    for (let i = 0; i < 100; i++) networkSim.tick();
    networkSim.alpha(0.08).restart();
}

function updateNetworkColors(agents) {
    if (!nodeEls) return;

    nodeEls
        .attr('fill', (_, i) => COLORS[agents[i]._viz || 'S'])
        .attr('stroke', (_, i) => {
            const v = agents[i]._viz || 'S';
            return v === 'S' ? '#d1d5db' : (v === 'I' ? 'none' : 'rgba(0,0,0,.1)');
        })
        .attr('r', (d, i) => agents[i]._viz === 'I' ? d.r * 1.35 : d.r);

    if (!linkEls) return;
    linkEls
        .attr('stroke', d => {
            const sv = agents[d.source.id]?._viz;
            const tv = agents[d.target.id]?._viz;
            if (sv === 'I' || tv === 'I') return 'rgba(239,68,68,.3)';
            if (sv === 'E' || tv === 'E') return 'rgba(245,158,11,.12)';
            return 'rgba(255,255,255,.04)';
        })
        .attr('stroke-width', d => {
            const sv = agents[d.source.id]?._viz;
            const tv = agents[d.target.id]?._viz;
            return (sv === 'I' || tv === 'I') ? 1.3 : 0.6;
        });
}

/* ═══════════════════════════════════════════════════════════
   D3 — MINI CHART  (simulation sidebar)
   ═══════════════════════════════════════════════════════════ */
function drawMiniChart(timeline, tNow) {
    const svgEl = $('miniChart');
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const m = { t: 4, r: 8, b: 18, l: 28 };
    const bw = svgEl.getBoundingClientRect().width;
    const W = (bw || 200) - m.l - m.r;
    const H = 120 - m.t - m.b;
    if (W <= 0 || H <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    const data = timeline.slice(0, tNow + 1);
    const N = timeline[0].S + timeline[0].I;
    const TMax = timeline.length - 1;

    const x = d3.scaleLinear().domain([0, TMax]).range([0, W]);
    const y = d3.scaleLinear().domain([0, N]).range([H, 0]);

    ['S', 'E', 'I', 'R'].forEach(key => {
        const line = d3.line().x((_, i) => x(i)).y(d => y(d[key])).curve(d3.curveMonotoneX);
        g.append('path').datum(data)
            .attr('fill', 'none')
            .attr('stroke', COLORS[key])
            .attr('stroke-width', key === 'I' ? 2 : 1.2)
            .attr('opacity', 0.85)
            .attr('d', line);
    });

    // x-axis
    g.append('g').attr('transform', `translate(0,${H})`)
        .call(d3.axisBottom(x).ticks(4).tickFormat(d => 'd' + d).tickSize(3))
        .selectAll('text').attr('fill', '#475569').attr('font-size', '7px');
    g.selectAll('.domain, .tick line').attr('stroke', '#2d3748');
}

/* ═══════════════════════════════════════════════════════════
   SHOW RESULTS — opens result modal, draws charts
   ═══════════════════════════════════════════════════════════ */
function showResults(result, config, avgTimeline) {
    const { agents, timeline, viralResult, finalEngagement, finalEngagementScore, peakVelocity, peakER, waktuViral, waktuRedam, engagementTimeline } = result;
    const chartTimeline = avgTimeline || timeline;
    const T = timeline.length - 1;
    const N = config.N;
    const fin = timeline[T];
    let isV = false;
    const totExp = N - fin.S;
    const peakI = Math.max(...timeline.map(s => s.I));
    const peakD = timeline.findIndex(s => s.I === peakI);
    const belCnt = agents.filter(a => a.believed).length;

    // ── Verdict banner ──
    let verdictClass = 'verdict-tidak-viral';
    let verdictIcon = '🦗';
    let verdictTitle = 'TIDAK VIRAL';
    let verdictDesc = '';

    if (waktuViral !== -1) {
        verdictClass = 'verdict-viral';
        verdictIcon = '🔥';
        verdictTitle = 'VIRAL';
        isV = true;
        
        if (waktuRedam !== -1) {
            verdictDesc = `<b>Mulai Viral: Hari ke-${waktuViral}</b><br><b>Mulai Padam: Hari ke-${waktuRedam}</b>`;
        } else {
            verdictDesc = `<b>Mulai Viral: Hari ke-${waktuViral}</b>`;
        }
    } else {
        verdictTitle = 'TIDAK VIRAL';
        verdictDesc = '';
    }

    $('verdictBanner').className = 'verdict-banner ' + verdictClass;
    $('vbIcon').textContent = verdictIcon;
    $('vbTitle').textContent = verdictTitle;
    $('vbDesc').innerHTML = verdictDesc;

    // ── Metric cards ──
    $('rm-views').textContent = fmt(finalEngagement.views);
    $('rm-likes').textContent = fmt(finalEngagement.likes);
    $('rm-comments').textContent = fmt(finalEngagement.comments);
    $('rm-shares').textContent = fmt(finalEngagement.shares);

    // ── Insight ──
    const peakEng = engagementTimeline[peakD] || { views: 0, likes: 0, comments: 0, shares: 0 };
    const prevEng = peakD > 0 ? (engagementTimeline[peakD - 1] || { views: 0, likes: 0, comments: 0, shares: 0 }) : { views: 0, likes: 0, comments: 0, shares: 0 };
    const dailyViews = Math.max(0, peakEng.views - prevEng.views);
    const dailyLikes = Math.max(0, peakEng.likes - prevEng.likes);
    const dailyComments = Math.max(0, peakEng.comments - prevEng.comments);
    const dailyShares = Math.max(0, peakEng.shares - prevEng.shares);
    const dailyER = dailyViews > 0 ? ((dailyLikes + dailyComments + dailyShares) / dailyViews * 100).toFixed(2) : 0;

    $('insightBox').innerHTML = `
    <strong style="display:block;margin-bottom:6px">💡 Insight</strong>
    Penyebaran mencapai puncak dengan jumlah penyebar aktif sebanyak <strong>${fmt(peakI)} agen</strong> pada hari ke-<strong>${peakD}</strong>. Pada hari tersebut, terdapat penambahan 
    <strong>${fmt(dailyViews)}</strong> views, 
    <strong>${fmt(dailyLikes)}</strong> likes,
    <strong>${fmt(dailyComments)}</strong> komentar, dan
    <strong>${fmt(dailyShares)}</strong> shares, serta
    memiliki engagement rate sebesar <strong>${dailyER}%</strong>.
    ${isV
            ? 'Konten menjadi viral karena berhasil mendapat lebih dari 500 views dan memiliki engagement rate lebih dari 5% dalam satu hari.'
            : 'Konten gagal menjadi viral. Penyebaran berhenti sebelum mendapatkan perhatian yang cukup dari pengguna lain.'}`;

    // ── Agent table ──
    populateAgentTable(agents);

    // ── Open modal, then draw charts ──
    openModal('resultModal');
    requestAnimationFrame(() => setTimeout(() => {
        drawResultSEIR(chartTimeline);
        drawResultDist(agents);
    }, 60));

    // ── Feed card ──
    createFeedCard(result, config);

    // ── UI updates ──
    $('openResultBtn').style.display = 'flex';
    $('notifDot').style.display = 'block';
    setTimeout(() => $('notifDot').style.display = 'none', 5000);
}

/* ═══════════════════════════════════════════════════════════
   D3 — RESULT SEIR TIME-SERIES CHART
   ═══════════════════════════════════════════════════════════ */
function drawResultSEIR(timeline) {
    const svgEl = $('resultChartSEIR');
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const m = { t: 10, r: 15, b: 36, l: 44 };
    const bw = svgEl.getBoundingClientRect().width;
    const W = (bw || 380) - m.l - m.r;
    const H = 200 - m.t - m.b;
    if (W <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    const N = timeline[0].S + timeline[0].I;
    const T = timeline.length - 1;
    const x = d3.scaleLinear().domain([0, T]).range([0, W]);
    const y = d3.scaleLinear().domain([0, N]).range([H, 0]);

    // Grid lines
    g.append('g')
        .call(d3.axisLeft(y).ticks(4).tickSize(-W).tickFormat(''))
        .selectAll('line').attr('stroke', '#e5e7eb').attr('stroke-opacity', 0.3);
    g.selectAll('.domain').remove();

    // Axes
    const axFont = { fill: '#64748b', 'font-size': '9px', 'font-family': "'IBM Plex Mono',monospace" };
    g.append('g').attr('transform', `translate(0,${H})`)
        .call(d3.axisBottom(x).ticks(8).tickFormat(d => 'H' + d))
        .selectAll('text').attr('fill', axFont.fill).attr('font-size', axFont['font-size']);
    g.append('g').call(d3.axisLeft(y).ticks(4))
        .selectAll('text').attr('fill', axFont.fill).attr('font-size', axFont['font-size']);
    svg.selectAll('.domain').attr('stroke', '#cbd5e1');
    svg.selectAll('.tick line').attr('stroke', '#e2e8f0');

    // Axis labels
    g.append('text')
        .attr('x', W / 2)
        .attr('y', H + 32)
        .attr('text-anchor', 'middle')
        .attr('fill', axFont.fill)
        .attr('font-size', '10px')
        .text('Jumlah Hari');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -H / 2)
        .attr('y', -32)
        .attr('text-anchor', 'middle')
        .attr('fill', axFont.fill)
        .attr('font-size', '10px')
        .text('Jumlah Agen');

    // Area + Line per status
    ['S', 'E', 'I', 'R'].forEach(key => {
        const area = d3.area().x((_, i) => x(i)).y0(H).y1(d => y(d[key])).curve(d3.curveMonotoneX);
        g.append('path').datum(timeline)
            .attr('fill', COLORS[key]).attr('fill-opacity', 0.07).attr('d', area);

        const line = d3.line().x((_, i) => x(i)).y(d => y(d[key])).curve(d3.curveMonotoneX);
        g.append('path').datum(timeline)
            .attr('fill', 'none').attr('stroke', COLORS[key])
            .attr('stroke-width', key === 'I' ? 2.5 : 1.8).attr('d', line);
    });

    // Inline legend
    const leg = g.append('g').attr('transform', `translate(${W - 150},4)`);
    ['S', 'E', 'I', 'R'].forEach((key, i) => {
        const gy = leg.append('g').attr('transform', `translate(${(i % 2) * 75},${Math.floor(i / 2) * 15})`);
        gy.append('circle').attr('r', 4).attr('fill', COLORS[key]);
        gy.append('text').attr('x', 8).attr('y', 4)
            .attr('font-size', '9px').attr('fill', '#64748b')
            .attr('font-family', "'IBM Plex Mono',monospace")
            .text(LABEL[key]);
    });
}

/* ═══════════════════════════════════════════════════════════
   D3 — RESULT FOLLOWER DISTRIBUTION CHART
   ═══════════════════════════════════════════════════════════ */
function drawResultDist(agents) {
    const svgEl = $('resultChartDist');
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const m = { t: 10, r: 15, b: 36, l: 44 };
    const bw = svgEl.getBoundingClientRect().width;
    const W = (bw || 380) - m.l - m.r;
    const H = 200 - m.t - m.b;
    if (W <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    const bins = 12;
    // Gunakan max follower dari agen biasa (bukan poster awal yang infectedDay = 0) untuk skala
    const ordinaryAgents = agents.filter(a => a.infectedDay !== 0);
    const agentsForScale = ordinaryAgents.length > 0 ? ordinaryAgents : agents;
    const maxF = Math.max(...agentsForScale.map(a => a.followers), 1);
    const bSz = Math.ceil(maxF / bins) || 1;

    const binData = Array.from({ length: bins }, (_, i) => {
        const lo = i * bSz;
        const hi = (i === bins - 1) ? Infinity : lo + bSz; // Bin terakhir menangkap semua outlier (termasuk poster)
        const ib = agents.filter(a => a.followers >= lo && a.followers < hi);
        return {
            x0: lo, x1: (i === bins - 1) ? lo + bSz : hi,
            S: ib.filter(a => a.status === 'S').length,
            E: ib.filter(a => a.status === 'E').length,
            I: ib.filter(a => a.status === 'I').length,
            R: ib.filter(a => a.status === 'R').length,
            total: ib.length,
        };
    });

    const x = d3.scaleBand().domain(binData.map((_, i) => i)).range([0, W]).padding(0.12);
    const yMax = d3.max(binData, d => d.total) || 1;
    const y = d3.scaleLinear().domain([0, yMax]).range([H, 0]);

    // Axes
    g.append('g').attr('transform', `translate(0,${H})`)
        .call(d3.axisBottom(x).tickFormat(i => {
            const v = binData[i]?.x0 ?? 0;
            return v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v;
        }))
        .selectAll('text').attr('fill', '#64748b').attr('font-size', '8px');
    g.append('g').call(d3.axisLeft(y).ticks(4))
        .selectAll('text').attr('fill', '#64748b').attr('font-size', '9px');
    svg.selectAll('.domain').attr('stroke', '#cbd5e1');
    svg.selectAll('.tick line').attr('stroke', '#e2e8f0');

    // Axis labels
    const axFont = { fill: '#64748b', 'font-size': '10px', 'font-family': "'IBM Plex Mono',monospace" };
    g.append('text')
        .attr('x', W / 2)
        .attr('y', H + 32)
        .attr('text-anchor', 'middle')
        .attr('fill', axFont.fill)
        .attr('font-size', '10px')
        .text('Jumlah Follower');

    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -H / 2)
        .attr('y', -32)
        .attr('text-anchor', 'middle')
        .attr('fill', axFont.fill)
        .attr('font-size', '10px')
        .text('Jumlah Agen');

    // Stacked bars
    binData.forEach((bin, i) => {
        let yOff = 0;
        ['S', 'E', 'I', 'R'].forEach(key => {
            if (bin[key] <= 0) return;
            const bH = y(0) - y(bin[key]);
            g.append('rect')
                .attr('x', x(i)).attr('y', H - yOff - bH)
                .attr('width', x.bandwidth()).attr('height', bH)
                .attr('fill', COLORS[key]).attr('opacity', 0.8).attr('rx', 2);
            yOff += bH;
        });
    });
}

/* ═══════════════════════════════════════════════════════════
   AGENT TABLE — sample 15 interesting agents
   ═══════════════════════════════════════════════════════════ */
function populateAgentTable(agents) {
    const by = { S: [], E: [], I: [], R: [] };
    agents.forEach(a => by[a.status].push(a));

    const sample = [];
    ['I', 'E', 'R', 'S'].forEach(s => {
        sample.push(...by[s].sort((a, b) => b.followers - a.followers).slice(0, 4));
    });

    $('agentTableBody').innerHTML = sample.slice(0, 15).map(a => `
    <tr>
      <td>#${String(a.id).padStart(3, '0')}</td>
      <td>${a.trustScore}</td>
      <td>${fmt(a.followers)}</td>
      <td><span class="st-badge st-${a.status}">${a.status} — ${LABEL[a.status]}</span></td>
      <td>${a.infectedDay >= 0 ? 'Hari ' + a.infectedDay : '—'}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   FEED CARD — Facebook-style post with result summary
   ═══════════════════════════════════════════════════════════ */
function createFeedCard(result, config) {
    $('feedHint').style.display = 'none';
    const feed = $('postFeed');

    const { viralResult, timeline, agents, finalEngagement } = result;
    const isV = viralResult.isViral;
    const T = timeline.length - 1;
    const totExp = config.N - timeline[T].S;
    const belCnt = agents.filter(a => a.believed).length;
    const now = lastPostData?.timestamp || new Date();
    const tStr = now.toLocaleTimeString('id', { hour: '2-digit', minute: '2-digit' });

    // Short verdict for badge
    let badgeText = 'TIDAK VIRAL';
    let badgeClass = 'hoax-badge-tidak-viral';

    if (result.waktuViral !== -1) {
        badgeClass = 'hoax-badge-viral';

        if (result.waktuRedam !== -1) {
            let daysViral = result.waktuRedam - result.waktuViral;
            badgeText = `VIRAL (${daysViral} hari)`;
        } else {
            let daysViral = T - result.waktuViral;
            badgeText = `MASIH VIRAL SETELAH ${params.simDays} HARI`;
        }
    }

    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
    <div class="pc-header">
      <div class="pc-ava" style="padding:0;overflow:hidden;"><img src="doksli/Kucingku.jpg" alt="Simulator User" style="width:100%;height:100%;object-fit:cover;object-position:center;border-radius:50%;"></div>
      <div class="pc-info">
        <div class="pc-poster">Ilham Jr.</div>
        <div class="pc-poster-sub">${tStr} · 🌐 Publik</div>
      </div>
    </div>
    <div class="pc-caption">${escapeHtml(lastPostData?.caption || '')}</div>
    ${lastPostData?.imageData
            ? `<img class="pc-img" src="${lastPostData.imageData}" alt="Post image">`
            : ''}
    <div class="hoax-badge ${badgeClass}">${badgeText}</div>
    <div class="pc-stats">
      <div class="pc-reactions">
        <span>😡</span><span>😮</span><span>👍</span>
        <span style="margin-left:4px">${fmt(finalEngagement.likes)} likes</span>
      </div>
      <span>${fmt(finalEngagement.comments)} comments · ${fmt(finalEngagement.shares)} shares</span>
    </div>`;
    feed.prepend(card);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ═══════════════════════════════════════════════════════════
   EVENT LISTENERS — wired on DOMContentLoaded
   ═══════════════════════════════════════════════════════════ */
function syncInput(rangeId, numId, defaultVal) {
    const range = $(rangeId);
    const num = $(numId);
    
    range.addEventListener('input', () => {
        num.value = range.value;
    });

    num.addEventListener('input', () => {
        let val = parseFloat(num.value);
        if (!isNaN(val) && val >= parseFloat(range.min) && val <= parseFloat(range.max)) {
            range.value = val;
        }
    });

    num.addEventListener('change', () => {
        let val = parseFloat(num.value);
        if (isNaN(val)) {
            num.value = defaultVal;
        } else if (val > parseFloat(range.max)) {
            num.value = range.max;
        } else if (val < parseFloat(range.min)) {
            num.value = range.min;
        }
        range.value = num.value;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupImageUpload();
    updateParamSummary();

    syncInput('pN', 'pNVal', 150);
    syncInput('pSigmaEI', 'pSigmaEIVal', 0.25);
    syncInput('pGamma', 'pGammaVal', 0.67);
    syncInput('pDuration', 'pDurVal', 15);
    syncInput('pSimDays', 'pSimDaysVal', 40);
    syncInput('pRuns', 'pRunsVal', 5);

    // ── Open params modal ──
    const openP = () => openModal('paramsModal');
    $('openParamsBtn').addEventListener('click', openP);
    $('openParamsBtn2').addEventListener('click', openP);

    // ── Open post modal ──
    const openPost = () => openModal('postModal');
    $('composerTrigger').addEventListener('click', openPost);
    $('openPostModalBtn').addEventListener('click', openPost);
    $('openPostModalBtn2').addEventListener('click', openPost);
    $('openPostModalBtn3').addEventListener('click', openPost);


    // ── Open result modal ──
    $('openResultBtn').addEventListener('click', () => {
        if (lastResult) openModal('resultModal');
    });

    // ── Close modals on overlay click ──
    document.querySelectorAll('.modal-overlay').forEach(ov => {
        ov.addEventListener('click', e => {
            if (e.target === ov) closeModal(ov.id);
        });
    });

    // ── Notification bell → open results ──
    $('notifBell').addEventListener('click', () => {
        if (lastResult) openModal('resultModal');
    });
});
