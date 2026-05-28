'use strict';

function randNorm(mu, sd) {
    const u1 = Math.random(), u2 = Math.random();
    return mu + sd * Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randNormClamped(mu, sd, min, max) {
    return Math.max(min, Math.min(max, randNorm(mu, sd)));
}

const INTELLIGENCE_CATEGORIES = {
    bodoh: { mu: 87.5, sigma: 4.17, min: 75, max: 100, label: 'Tidak Cerdas' },
    fomo: { mu: 50, sigma: 8.33, min: 25, max: 75, label: 'Fomo' },
    pintar: { mu: 12.5, sigma: 4.17, min: 0, max: 25, label: 'Cerdas' },
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

const TRUST_THRESHOLD = 50;

const ViralEngine = {
  WEIGHTS: {
    like: 1.0,
    comment: 2.5,
    share: 4.0
  },

  calculateEngagementScore(actions) {
    const { likes, comments, shares } = actions;
    return (likes * this.WEIGHTS.like) + 
           (comments * this.WEIGHTS.comment) + 
           (shares * this.WEIGHTS.share);
  },

  evaluateVirality(post, timelineInteractions, threshold = { velocity: 500, er: 0.05 }, wasViralBefore = false) {
    const currentHour = timelineInteractions.length;
    if (currentHour === 0) return { isViral: false, status: 'Draft/Baru', verdict: 'TIDAK VIRAL' };

    const latestData = timelineInteractions[currentHour - 1];
    const previousData = currentHour > 1 ? timelineInteractions[currentHour - 2] : { views: 0 };
    const viewVelocity = latestData.views - previousData.views;
    const totalEngagement = latestData.likes + latestData.comments + latestData.shares;
    const engagementRate = latestData.views > 0 ? (totalEngagement / latestData.views) : 0;

    const engagementScore = this.calculateEngagementScore(latestData);
    
    let isViral = false;
    if (currentHour > 1) {
        const meetsVelocity = viewVelocity >= threshold.velocity;
        const meetsEngagement = engagementRate >= threshold.er;
        isViral = meetsVelocity && meetsEngagement;
    }

    let verdict = 'TIDAK VIRAL';
    if (isViral) {
      verdict = '🔥 VIRAL';
    } 
    else if (wasViralBefore) {
      verdict = '💎 PADAM';
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

  generateEngagementTimeline(timeline, agents, config) {
    const N = config.N;
    const pMult = (ACCOUNT_CATEGORIES[config.posterType]?.mult) || 1.0;
    const interactions = [];
    
    let cumulativeViews = 0;
    let cumulativeLikes = 0;
    let cumulativeComments = 0;
    let cumulativeShares = 0;

    for (let t = 0; t < timeline.length; t++) {
      const snap = timeline[t];
      const activeInfected = snap.I;
      const exposed = snap.E;
      
      let totalActiveFollowers = 0;
      for (const a of agents) {
          if (a.history && a.history[t] === 'I') {
              totalActiveFollowers += a.followers;
          }
      }
      
      let newViews = Math.round(totalActiveFollowers * pMult * (0.3 + Math.random() * 0.4));
      
      let newLikes = Math.round(newViews * (0.02 + Math.random() * 0.06)) + Math.round(activeInfected * 0.8 + exposed * 0.2);
      let newComments = Math.round(newViews * (0.005 + Math.random() * 0.015)) + Math.round(activeInfected * 0.3 + exposed * 0.05);
      let newShares = Math.round(newViews * (0.002 + Math.random() * 0.008)) + Math.round(activeInfected * 0.5);

      const totalNewEngagement = newLikes + newComments + newShares;
      if (totalNewEngagement > newViews) {
          newViews = totalNewEngagement + Math.round(totalNewEngagement * (0.1 + Math.random() * 0.3));
      }

      cumulativeViews += newViews;
      cumulativeLikes += newLikes;
      cumulativeComments += newComments;
      cumulativeShares += newShares;

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
            trustScore,
            status: 'S',
            subState: null,
            infectedDay: -1,
            contacts: 0,
            believed: false,
            exposedBy: null,
            secondaryInfections: 0,
        });
    }
    return agents;
}

function computeTransProbs(agent, params) {
    const { fypRate, sigma, gamma } = params;

    const believeProb = agent.trustScore / 100;

    return {
        pRtR: 1 - fypRate,
        pRtB: fypRate * believeProb,
        pRtD: fypRate * (1 - believeProb),
        pDtR: 0.2,
        pDtF: 0.8,
        pBtT: sigma,
        pBtR: 0.1,
        pBtF: Math.max(0, 1 - sigma - 0.1),
        pTtT: 1 - gamma,
        pTtR: gamma * 0.3,
        pTtF: gamma * 0.7,
    };
}

function stepAgents(agents, params, day) {
    const N = agents.length;
    const I_count = agents.filter(a => a.status === 'I').length;
    const newStatuses = [];

    for (const agent of agents) {
        const tp = computeTransProbs(agent, params);
        let next = { ...agent };

        if (agent.status === 'S') {
            if (I_count > 0) {
                const kontak_i = agent.followers * (I_count / N);

                const believeProb = agent.trustScore / 100;
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
                const r = Math.random();
                if (r < tp.pRtB) {
                    next.subState = 'B';
                    next.believed = true;
                } else if (r < tp.pRtB + tp.pRtD) {
                    next.subState = 'D';
                    next.status = 'R';
                }
            }
            if (next.subState === 'B') {
                const r2 = Math.random();
                if (r2 < tp.pBtT) {
                    next.status = 'I';
                    next.subState = 'T';
                    if (typeof agent.exposedBy === 'number') {
                        agents[agent.exposedBy].secondaryInfections++;
                    }
                } else if (r2 < tp.pBtT + tp.pBtF) {
                    next.status = 'R';
                    next.subState = 'F';
                } else {
                    next.subState = 'R';
                }
            }

        } else if (agent.status === 'I') {
            const r = Math.random();
            if (r < tp.pTtF + tp.pTtR) {
                next.status = 'R';
                next.subState = 'F';
            }
        }
        newStatuses.push(next);
    }

    for (let i = 0; i < agents.length; i++) {
        Object.assign(agents[i], newStatuses[i]);
    }
}

function countStates(agents) {
    const c = { S: 0, E: 0, I: 0, R: 0 };
    agents.forEach(a => c[a.status]++);
    return c;
}

function runSimulation(config) {
    const {
        N, muFollower, sdFollower,
        posterMuFollower, posterSdFollower,
        posterType,
        fypCategory, intelligenceCategory,
        sigma, gamma, T,
        I0 = 1
    } = config;

    const pMult = (ACCOUNT_CATEGORIES[posterType]?.mult) || 1.0;

    let fypRate;
    const fypCat = FYP_CATEGORIES[fypCategory];
    fypRate = fypCat
        ? randNormClamped(fypCat.mu, fypCat.sigma, fypCat.min, fypCat.max)
        : 0.2;

    const effFyp = Math.min(fypRate * pMult, 0.98);

    const agents = createAgents(N, muFollower, sdFollower, intelligenceCategory);

    const sorted = [...agents].sort((a, b) => b.followers - a.followers);
    for (let k = 0; k < Math.min(I0, N); k++) {
        sorted[k].status = 'I';
        sorted[k].subState = 'T';
        sorted[k].infectedDay = 0;
        sorted[k].followers = Math.max(0, Math.round(randNorm(posterMuFollower, posterSdFollower)));
    }

    for (let i = 0; i < N; i++) {
        agents[i].history = [agents[i].status];
    }

    const params = { fypRate: effFyp, sigma, gamma };

    const timeline = [countStates(agents)];

    for (let t = 1; t <= T; t++) {
        stepAgents(agents, params, t);
        for (let i = 0; i < N; i++) agents[i].history.push(agents[i].status);
        const counts = countStates(agents);
        timeline.push(counts);

        if (counts.E === 0 && counts.I === 0) {
            break;
        }
    }
    const engagementTimeline = ViralEngine.generateEngagementTimeline(timeline, agents, config);

    let peakVelocity = 0;
    let peakER = 0;
    let waktuViral = -1;
    let waktuRedam = -1;
    let peakHour = 1;
    let hasBeenViral = false;

    const hourlyEvaluations = [];
    for (let h = 1; h <= engagementTimeline.length; h++) {
        const evalH = ViralEngine.evaluateVirality(
            { caption: 'sim' },
            engagementTimeline.slice(0, h),
            { velocity: 500, er: 0.05 },
            hasBeenViral
        );
        hourlyEvaluations.push(evalH);
        
        if (evalH.isViral) {
            hasBeenViral = true;
        }
        
        if (evalH.viewVelocityPerHour > peakVelocity) {
            peakVelocity = evalH.viewVelocityPerHour;
            peakHour = h;
        }
        if (evalH.engagementRateRaw > peakER) peakER = evalH.engagementRateRaw;
        
        if (evalH.isViral) {
            if (waktuViral === -1) waktuViral = h - 1;
            waktuRedam = -1;
        } else {
            if (waktuViral !== -1 && waktuRedam === -1) {
                waktuRedam = h - 1;
            }
        }
    }

    const viralResult = ViralEngine.evaluateVirality(
        { caption: 'sim' }, 
        engagementTimeline.slice(0, peakHour),
        { velocity: 500, er: 0.05 }
    );

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
        params: { effFyp, pMult },
        sampledValues: { fypRate }
    };
}

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
    INTELLIGENCE_CATEGORIES, FYP_CATEGORIES, ACCOUNT_CATEGORIES
};
