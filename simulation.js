/* simulation.js — ABM-SEIR Engine
 * Berdasarkan: Maximov & Shvetcov (IEEE Inforino 2024)
 * Model: Probabilistic Finite Automaton per agen
 *
 * Status agen (dari paper):
 *   R  → menerima (Susceptible/Exposed)
 *   B  → percaya (Believes) — akan menyebarkan
 *   D  → tidak percaya (Distrust)
 *   T  → transmitting / Infectious
 *   F  → final (Removed)
 *
 * Mapping ke SEIR:
 *   S = belum terpapar
 *   E = R (menerima, belum memutuskan)
 *   I = B+T (percaya & menyebarkan)
 *   R_out = D+F (tidak percaya / berhenti)
 */

'use strict';

// ── Category Configurations ──────────────────────────
const INTELLIGENCE_CATEGORIES = {
    bodoh: { mu: 87.5, sigma: 4.17, min: 75, max: 100, label: 'Bodoh' },
    fomo: { mu: 50, sigma: 8.33, min: 25, max: 75, label: 'FOMO' },
    pintar: { mu: 12.5, sigma: 4.17, min: 0, max: 25, label: 'Pintar' },
};

const CREDIBILITY_CATEGORIES = {
    trustworthy: { mu: 0.80, sigma: 0.067, min: 0.6, max: 1.0, label: 'Dapat Dipercaya' },
    untrustworthy: { mu: 0.30, sigma: 0.067, min: 0.1, max: 0.5, label: 'Tidak Dapat Dipercaya' },
};

const FYP_CATEGORIES = {
    fyp: { mu: 0.75, sigma: 0.083, min: 0.5, max: 1.0, label: 'FYP' },
    tidakFyp: { mu: 0.175, sigma: 0.042, min: 0.05, max: 0.3, label: 'Tidak FYP' },
};

const ACCOUNT_CATEGORIES = {
    ordinary: { mult: 1.0, label: 'Orang Biasa' },
    creator: { mult: 1.6, label: 'Content Creator' },
    media: { mult: 2.2, label: 'Media / Berita' },
    influencer: { mult: 3.0, label: 'Influencer' },
};

// Fixed trust threshold — categories control the distribution of trust scores
const TRUST_THRESHOLD = 50;

/* ═══════════════════════════════════════════════════════════
   ViralEngine — Engagement & Velocity Based Detection
   ═══════════════════════════════════════════════════════════ */

const ViralEngine = {
  // Konfigurasi Bobot Algoritma Rekomendasi Platform
  WEIGHTS: {
    like: 1.0,
    comment: 2.5,   // Komentar diberi bobot lebih tinggi karena memicu interaksi
    share: 4.0      // Share paling tinggi karena memperluas jangkauan jaringan
  },

  /**
   * Menghitung skor interaksi berdasarkan aksi pengguna
   */
  calculateEngagementScore(actions) {
    const { likes, comments, shares } = actions;
    return (likes * this.WEIGHTS.like) + 
           (comments * this.WEIGHTS.comment) + 
           (shares * this.WEIGHTS.share);
  },

  /**
   * Simulasi evaluasi konten oleh algoritma setiap jamnya
   * @param {Object} post - Data postingan saat ini
   * @param {Array} timelineInteractions - Riwayat interaksi tiap jam [{likes, comments, shares, views}]
   * @param {Object} threshold - Batas minimum penentu (Benchmark platform)
   */
  evaluateVirality(post, timelineInteractions, threshold = { velocity: 500, er: 0.05 }) {
    const currentHour = timelineInteractions.length;
    if (currentHour === 0) return { isViral: false, status: 'Draft/Baru' };

    // 1. Ambil data jam terakhir
    const latestData = timelineInteractions[currentHour - 1];
    
    // 2. Hitung Velocity (Laju Pertumbuhan Impresi per Jam)
    const previousData = currentHour > 1 ? timelineInteractions[currentHour - 2] : { views: 0 };
    const viewVelocity = latestData.views - previousData.views;

    // 3. Hitung Real-time Engagement Rate (ER) berdasarkan proporsi totalInteractions / totalExposed
    const totalEngagement = latestData.likes + latestData.comments + latestData.shares;
    const engagementRate = latestData.exposed > 0 ? (totalEngagement / latestData.exposed) : 0;

    // 4. Hitung Skor Akselerasi Algoritma
    const engagementScore = this.calculateEngagementScore(latestData);

    // 5. Penentuan Status Viralitas
    const meetsVelocity = viewVelocity >= threshold.velocity;
    const meetsEngagement = engagementRate >= threshold.er;
    const isViral = meetsVelocity && meetsEngagement;

    let verdict = 'Stagnan';
    if (isViral) {
      verdict = '🔥 VIRAL (Akselerasi Algoritma)';
    } else if (meetsVelocity && !meetsEngagement) {
      verdict = '📈 Impresi Tinggi tapi Menguap (Kurang Interaksi / Clickbait)';
    } else if (!meetsVelocity && meetsEngagement) {
      verdict = '💎 Berkualitas tapi Kurang Dorongan Algoritma (Cluster Kecil)';
    }

    return {
      hour: currentHour,
      viewVelocityPerHour: viewVelocity,
      engagementRate: parseFloat((engagementRate * 100).toFixed(2)) + '%',
      engagementRateRaw: engagementRate,
      engagementScore: engagementScore,
      isViral: isViral,
      verdict: verdict
    };
  },

  /**
   * Generate simulated engagement data dari hasil ABM-SEIR
   * Mengkonversi timeline SEIR menjadi data interaksi platform
   */
  generateEngagementTimeline(timeline, agents, config) {
    const N = config.N;
    const muFollower = config.muFollower;
    const pMult = (ACCOUNT_CATEGORIES[config.posterType]?.mult) || 1.0;
    const interactions = [];
    
    let cumulativeViews = 0;
    let cumulativeLikes = 0;
    let cumulativeComments = 0;
    let cumulativeShares = 0;

    for (let t = 0; t < timeline.length; t++) {
      const snap = timeline[t];
      // Agen yang Infected (I) aktif menyebarkan → mereka generate views dari follower mereka
      const activeInfected = snap.I;
      const exposed = snap.E;
      
      // Views: setiap penyebar aktif menjangkau rata-rata follower mereka, ditambah efek FYP
      const newViews = Math.round(activeInfected * muFollower * pMult * (0.3 + Math.random() * 0.4));
      cumulativeViews += newViews;

      // Likes: sebagian kecil dari yang terpapar & percaya
      const newLikes = Math.round((activeInfected + exposed * 0.3) * (5 + Math.random() * 15) * pMult);
      cumulativeLikes += newLikes;

      // Comments: lebih sedikit dari likes, tapi bobot lebih besar
      const newComments = Math.round((activeInfected * 0.4 + exposed * 0.1) * (2 + Math.random() * 5) * pMult);
      cumulativeComments += newComments;

      // Shares: hanya agen I yang aktif share
      const newShares = Math.round(activeInfected * (1 + Math.random() * 3) * pMult);
      cumulativeShares += newShares;

      // Total Exposed adalah N - S (seluruh agen yang bukan S lagi)
      const totalExposed = N - snap.S;

      interactions.push({
        views: cumulativeViews,
        likes: cumulativeLikes,
        comments: cumulativeComments,
        shares: cumulativeShares,
        exposed: totalExposed
      });
    }
    return interactions;
  }
};

// ── RNG Helpers ──────────────────────────────────────
function randNorm(mu, sd) {
    const u1 = Math.random(), u2 = Math.random();
    return mu + sd * Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randNormClamped(mu, sd, min, max) {
    return Math.max(min, Math.min(max, randNorm(mu, sd)));
}

function bernoulli(p) { return Math.random() < p; }

function binomialSample(n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 40) {
        let k = 0;
        for (let i = 0; i < n; i++) if (Math.random() < p) k++;
        return k;
    }
    const mu = n * p, sd = Math.sqrt(n * p * (1 - p));
    const z = Math.sqrt(-2 * Math.log(Math.random() || 1e-10)) * Math.cos(2 * Math.PI * Math.random());
    return Math.max(0, Math.min(n, Math.round(mu + sd * z)));
}

// ── Agent Factory ────────────────────────────────────
function createAgents(N, muFollower, sdFollower, intelligenceCategory) {
    const agents = [];
    const intCat = INTELLIGENCE_CATEGORIES[intelligenceCategory];

    for (let i = 0; i < N; i++) {
        const followers = Math.max(0, Math.round(randNorm(muFollower, sdFollower)));

        let trustScore;
        if (intCat) {
            trustScore = Math.round(randNormClamped(intCat.mu, intCat.sigma, intCat.min, intCat.max));
        } else {
            trustScore = Math.max(0, Math.min(100, Math.round(randNorm(50, 25))));
        }

        agents.push({
            id: i,
            followers,
            trustScore,       // seberapa mudah percaya konten (0-100)
            status: 'S',      // S | E | I | R
            subState: null,
            infectedDay: -1,
            contacts: 0,
            believed: false,
            exposedBy: null,            // ID of agent who exposed this agent
            secondaryInfections: 0,     // Counter for successful secondary infections caused
        });
    }
    return agents;
}

// ── Transition probabilities (berdasarkan paper) ─────
// p(RtR) + p(RtB) + p(RtD) = 1
// p(DtR) + p(DtF) = 1
// p(BtR) + p(BtT) + p(BtF) = 1
// p(TtR) + p(TtT) + p(TtF) = 1

function computeTransProbs(agent, params) {
    const { credibility, fypRate, sigma, gamma } = params;

    // Pengaruh kepercayaan agen terhadap konten
    // Threshold fixed at 50 — category controls distribution
    const believeProb = agent.trustScore > TRUST_THRESHOLD
        ? credibility  // agen gampang percaya → ikuti credibility
        : credibility * 0.4; // agen skeptis → diturunkan

    return {
        // Dari R (Exposed/receiving)
        pRtR: 1 - fypRate,                  // menolak menerima / tidak FYP
        pRtB: fypRate * believeProb,        // FYP + percaya → B
        pRtD: fypRate * (1 - believeProb),  // FYP + tidak percaya → D

        // Dari D (Distrust)
        pDtR: 0.2,                          // bisa menerima pesan lain lagi
        pDtF: 0.8,                          // berhenti, tidak menyebarkan

        // Dari B (Believe)
        pBtT: sigma * credibility,          // menyebarkan (T)
        pBtR: 0.1,                          // urung, kembali menerima
        pBtF: Math.max(0, 1 - sigma * credibility - 0.1), // final tanpa sebarkan

        // Dari T (Transmitting)
        pTtT: 1 - gamma,                    // tetap menyebarkan
        pTtR: gamma * 0.3,                  // kembali menerima
        pTtF: gamma * 0.7,                  // berhenti sebarkan
    };
}

// ── Single Step ──────────────────────────────────────
function stepAgents(agents, params, day) {
    const N = agents.length;
    const I_count = agents.filter(a => a.status === 'I').length;

    // Apply transitions per agen
    const newStatuses = [];

    for (const agent of agents) {
        const tp = computeTransProbs(agent, params);
        let next = { ...agent };

        if (agent.status === 'S') {
            if (I_count > 0) {
                // kontak_i = expected number of active spreaders this agent follows
                const kontak_i = agent.followers * (I_count / N);

                // P(terekspos) = 1 - (1 - beta)^kontak_i
                // beta combines FYP rate and believe probability
                const believeProb = agent.trustScore > 50 ? params.credibility : params.credibility * 0.4;
                const beta = params.fypRate * believeProb;

                const pTerekspos = 1 - Math.pow(1 - beta, kontak_i);

                if (Math.random() < pTerekspos) {
                    next.status = 'E';
                    next.subState = 'R';
                    next.infectedDay = day;
                    next.exposedBy = 'network';
                }
            }

        } else if (agent.status === 'E') {
            if (agent.subState === 'R') {
                // Sub-state R: terima pesan, putuskan
                const r = Math.random();
                if (r < tp.pRtB) {
                    next.subState = 'B';
                    next.believed = true;
                } else if (r < tp.pRtB + tp.pRtD) {
                    next.subState = 'D';
                    next.status = 'R'; // tidak percaya → R (removed)
                }
            }

            // Dari B: transisi ke I (Transmitting) atau F (Removed)
            if (next.subState === 'B') {
                const r2 = Math.random();
                if (r2 < tp.pBtT) {
                    next.status = 'I';
                    next.subState = 'T';
                    // Catat sukses infeksi sekunder untuk agen yang mengekspos
                    if (typeof agent.exposedBy === 'number') {
                        agents[agent.exposedBy].secondaryInfections++;
                    }
                } else if (r2 < tp.pBtT + tp.pBtF) {
                    next.status = 'R'; // B → F
                    next.subState = 'F';
                } else {
                    // pBtR -> kembali menerima (R)
                    next.subState = 'R';
                }
            }

        } else if (agent.status === 'I') {
            // Sub-state T: menyebarkan
            const r = Math.random();
            if (r < tp.pTtF + tp.pTtR) {
                next.status = 'R';
                next.subState = 'F';
            }
            // else: tetap I (TtT)
        }
        // R adalah absorbing state

        newStatuses.push(next);
    }

    // Apply
    for (let i = 0; i < agents.length; i++) {
        Object.assign(agents[i], newStatuses[i]);
    }
}

// ── Count states ─────────────────────────────────────
function countStates(agents) {
    const c = { S: 0, E: 0, I: 0, R: 0 };
    agents.forEach(a => c[a.status]++);
    return c;
}

// ── Full Simulation (single run) ─────────────────────
function runSimulation(config) {
    const {
        N, muFollower, sdFollower,
        posterType,
        credibilityCategory, fypCategory, intelligenceCategory,
        sigma, gamma, T,
        I0 = 1
    } = config;

    // Poster multiplier (dari tipe akun)
    const pMult = (ACCOUNT_CATEGORIES[posterType]?.mult) || 1.0;

    // Determine credibility from category
    let credibility;
    const credCat = CREDIBILITY_CATEGORIES[credibilityCategory];
    credibility = credCat
        ? randNormClamped(credCat.mu, credCat.sigma, credCat.min, credCat.max)
        : 0.4;

    // Determine FYP rate from category
    let fypRate;
    const fypCat = FYP_CATEGORIES[fypCategory];
    fypRate = fypCat
        ? randNormClamped(fypCat.mu, fypCat.sigma, fypCat.min, fypCat.max)
        : 0.2;

    const effCredibility = Math.min(credibility * pMult, 0.98);
    const effFyp = Math.min(fypRate * pMult, 0.98);

    const agents = createAgents(N, muFollower, sdFollower, intelligenceCategory);

    // Seed I0 spreaders — pilih yang paling banyak follower
    const sorted = [...agents].sort((a, b) => b.followers - a.followers);
    for (let k = 0; k < Math.min(I0, N); k++) {
        sorted[k].status = 'I';
        sorted[k].subState = 'T';
        sorted[k].infectedDay = 0;
    }

    // Initialize history
    for (let i = 0; i < N; i++) {
        agents[i].history = [agents[i].status];
    }

    const params = { credibility: effCredibility, fypRate: effFyp, sigma, gamma };

    // Timeline
    const timeline = [countStates(agents)];

    for (let t = 1; t <= T; t++) {
        stepAgents(agents, params, t);
        for (let i = 0; i < N; i++) agents[i].history.push(agents[i].status);
        const counts = countStates(agents);
        timeline.push(counts);

        // Hentikan simulasi jika sudah tidak ada yang terpapar (E) dan menyebarkan (I)
        if (counts.E === 0 && counts.I === 0) {
            break;
        }
    }

    // ── Kalkulasi Engagement & Velocity (ViralEngine) ──
    const engagementTimeline = ViralEngine.generateEngagementTimeline(timeline, agents, config);
    
    // Evaluasi viralitas berdasarkan data engagement terakhir
    const viralResult = ViralEngine.evaluateVirality(
        { caption: 'sim' }, 
        engagementTimeline,
        { velocity: 500, er: config.N * 0.05 }
    );

    // Hitung peak engagement & velocity, serta waktu viral & redam
    let peakVelocity = 0;
    let peakER = 0;
    let waktuViral = -1;
    let waktuRedam = -1;
    const hourlyEvaluations = [];
    for (let h = 1; h <= engagementTimeline.length; h++) {
        const evalH = ViralEngine.evaluateVirality(
            { caption: 'sim' },
            engagementTimeline.slice(0, h),
            { velocity: 500, er: config.N * 0.05 }
        );
        hourlyEvaluations.push(evalH);
        if (evalH.viewVelocityPerHour > peakVelocity) peakVelocity = evalH.viewVelocityPerHour;
        if (evalH.engagementRateRaw > peakER) peakER = evalH.engagementRateRaw;
        
        // Track waktu viral dan redam
        if (evalH.isViral) {
            if (waktuViral === -1) waktuViral = h - 1; // index 0 is Day 0
            waktuRedam = -1; // reset jika kembali viral
        } else {
            if (waktuViral !== -1 && waktuRedam === -1) {
                waktuRedam = h - 1;
            }
        }
    }

    // Data engagement terakhir (kumulatif)
    const finalEngagement = engagementTimeline[engagementTimeline.length - 1];
    const finalEngagementScore = ViralEngine.calculateEngagementScore(finalEngagement);

    return {
        agents, timeline,
        viralResult,
        engagementTimeline,
        hourlyEvaluations,
        finalEngagement,
        finalEngagementScore,
        peakVelocity,
        peakER,
        waktuViral,
        waktuRedam,
        params: { effCredibility, effFyp, pMult },
        sampledValues: { credibility, fypRate }
    };
}

// ── Monte Carlo (multiple runs, average) ─────────────
function runMonteCarlo(config, runs = 5) {
    const T = config.T;
    const accS = new Float64Array(T + 1);
    const accE = new Float64Array(T + 1);
    const accI = new Float64Array(T + 1);
    const accR = new Float64Array(T + 1);

    let lastResult = null;

    for (let r = 0; r < runs; r++) {
        const res = runSimulation(config);
        for (let t = 0; t <= T; t++) {
            const snap = res.timeline[t] || res.timeline[res.timeline.length - 1];
            accS[t] += snap.S; accE[t] += snap.E;
            accI[t] += snap.I; accR[t] += snap.R;
        }
        if (r === 0) lastResult = res;
    }

    const avg = {
        S: Array.from(accS).map(v => Math.round(v / runs)),
        E: Array.from(accE).map(v => Math.round(v / runs)),
        I: Array.from(accI).map(v => Math.round(v / runs)),
        R: Array.from(accR).map(v => Math.round(v / runs)),
    };

    return { avg, lastResult };
}

window.SimEngine = {
    runSimulation, runMonteCarlo, createAgents, countStates, ViralEngine,
    INTELLIGENCE_CATEGORIES, CREDIBILITY_CATEGORIES, FYP_CATEGORIES, ACCOUNT_CATEGORIES
};
