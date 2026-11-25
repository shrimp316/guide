// U6a: NewWorldBalanceSimulation driver (A_core.md 2.1-2.4): Setup, Step/Advance, sessions, Act, RefreshDaily/Status, TryRankUps, Finish.
// Browser-safe: master data comes in via opts.master (Node tests use node_loader.loadMaster()).
// Spend logic lives in sim_gold.js (6a), sim_gems.js (6b), sim_power.js (6c), sim_world.js (6d); pioneers in sim_pioneers.js (U5).
import { BigNumber } from './bignum.js';
import * as T from './timestamp.js';
import * as E from './game_econ.js';
import * as W from './game_world.js';
import { UpgradeStatus } from './upgrade_status.js';
import { simRefreshStatus, initStatusState } from './status/refresh.js';
import { NewWorldRankUpPower } from './expr_x.js';
import { PioneersBot } from './sim_pioneers.js';
import { refreshPioneersExternalEffects } from './pioneers_econ.js';
import { validateNewWorldContentProgress } from './world_batch.js';
import * as gold from './sim_gold.js';
import * as gems from './sim_gems.js';
import * as power from './sim_power.js';
import * as world from './sim_world.js';

/** Bump ONLY when a change alters simulation results (cache key for callers); bit-identical optimisations keep it. */
export const ENGINE_VERSION = 'u6-2';

export const NW_MEMBERSHIPS = ['ms_ads', 'ms_booster', 'ms_mission', 'ms_power', 'ms_soul', 'ms_science', 'ms_quantum'];
const RANK_MAX_BY_DIFFICULTY = [10, 15, 20, 20];   // M.GetNewWorldRankMax: max Rank with DifficultyType <= d (RESOLVED_CONSTANTS 5)

/** Settings defaults (SIM_SPEC ch.2). */
export function defaultSettings() {
  return {
    ThemeId: 90001, Difficulty: 2, EventNumber: 990001, Seed: 93487,
    StartKst: [2026, 11, 1], SeasonDays: 6,
    SessionStartHours: [8, 12, 19],
    OnlineHoursPerDay: 6, StepSeconds: 60, ActionIntervalSeconds: 300,
    GoldenPowerAccelerationIntervalSeconds: 5400, GoldenPowerAccelerationRatio: 0.25,
    PioneersStepSeconds: 2, FieldDpsFactor: 1, FieldBoardCycleSeconds: 3.16, FieldOverkillHitsPerKill: 3,
    GoldenCardLevel: 5, IncludeAds: true, IncludeMembershipGems: true, WorldTreeGrowthRatio: 0,
    SavingHorizonSeconds: 1800, TradingRatios: [0.1, 0.2, 0.1, 0.1],
    PioneersResearchManaRatio: 0.1, IdleManaRatio: 0.5, SpecializationPointGain: 0.1, ArcSavingHorizonSeconds: 7200,
    PowerSpendRatio: 0.001, MaxShrines: 4, IncludeInnovationLabProduction: true, GemBudget: 0,
    Policy: gems.createGemPolicy(), IncludeLimitedPackages: true,
    nwPass: true, NwPassDays: undefined, NwPassDayGems: 900,
  };
}

const require0 = (code, what) => { if (code !== 0) throw new Error(`${what} failed: ${code}`); };   // sim.Require @4165310

export class Sim {
  constructor(m, S, { goldenCardLevels, memberships }) {
    this.m = m; this.S = S; this.settings = S;
    this.constraints = new Map(); this.warnings = []; this.warned = new Set();
    this.rankTimeline = []; this.passGems = 0; this.lastPassOn = false; this.purchases = 0; this.dayIndex = -1; this.isFinished = false; this.isManaIdle = false;

    const g = this.g = this.data = W.createWorldState(m, E.createEconState(m, { themeId: S.ThemeId, eventNumber: S.EventNumber, difficulty: S.Difficulty, rankMax: this.rankMaxFor(S) }));
    initStatusState(g);
    g.PioneersIngots = BigNumber.ZERO; g.PioneersManaStone = BigNumber.ZERO; g.Pioneers = null;
    const bal = { 100: ['gold', E.modifyGold], 101: ['power', E.modifyPower], 102: ['soul', E.modifySoul], 105: ['science', E.modifySciencePoint], 153: ['mana', W.modifyMana] };
    g.getBalance = (id) => g[bal[id][0]];
    g.modifyBalance = (id, d) => bal[id][1](g, d);
    this.u = this.user = {
      states: new Map(NW_MEMBERSHIPS.filter((id) => memberships[id]).map((id) => [id, 1])), newWorldPassEnabled: false,
      isUnlockedContents: (id) => E.isUnlockedContents(m, g, id),
    };
    this.st = new UpgradeStatus(m, 10, 0x1b0);
    this.goldenCardLevels = goldenCardLevels;
    this.goldenPowerIds = [1, 2, 3, 4, 5, 6, 10, 11, 12];   // NewWorldGoldenPowerIds (RESOLVED_CONSTANTS)
    this.bot = new PioneersBot(this);
  }
  rankMaxFor(S) { return RANK_MAX_BY_DIFFICULTY[S.Difficulty] ?? 20; }
  isUnlocked(id) { return this.u.isUnlockedContents(id); }
  contentPending() { return W.isNewWorldContentPending(this.g); }
  warn(key, msg) { if (!this.warned.has(key)) { this.warned.add(key); this.warnings.push(`${key}: ${msg}`); } }
  setNow(t) { this.now = t; this.g.gameTime = t; }
  /** WithVirtualTime @41715a8 */
  withVirtualTime(fn, ms = 0) { this.g.gameTime = this.now + ms; try { return fn(); } finally { this.g.gameTime = this.now; } }

  // ---- delegates to the part modules (contract used by sim_gems/power/world)
  grantReward(id) { return gems.grantReward(this, id); }
  spendGems(daily) { return gems.spendGems(this, daily); }
  spendWorldCrystal() { return world.spendWorldCrystal(this); }
  maintainClockTower() { return world.maintainClockTower(this); }
  tryRankUps() { return this.tryRankUpsImpl(); }

  setup() {
    const { m, g, S, st } = this;
    this.rankMax = this.rankMaxFor(S);
    this.start = T.fromKst(...S.StartKst);
    this.end = T.addDays(this.start, S.SeasonDays);
    const row = m.setting('NewWorldSetting'), d = S.Difficulty;
    this.constraints.set(0x1e, row.LimitWeapon[d] + 1); this.constraints.set(10, row.LimitResearch[d]); this.constraints.set(0x16, row.LimitField[d]);
    W.setupGoldenCards(m, g, S.ThemeId, this.goldenCardLevels ?? S.GoldenCardLevel);
    if (S.nwPass) require0(W.setNewWorldPassEntitlement(g, true).code, 'SetNewWorldPassEntitlement');
    W.ensureWorldStone(m, g, st, S.EventNumber, S.Seed);
    this.refreshStatus();
    E.check(m, g, st, this.constraints);
    const first = this.getFirstSessionStart();
    this.setNow(first);
    this.nextActionAt = this.nextGoldenPowerAt = first;
    this.processContent(first);
    gems.buyStartProducts(this);
    this.refreshDaily();
    this.act();
  }

  // ---- RefreshStatus @416547c / GetPassExcludedBonus @41678ac (status.+0x10 = false: no division)
  /** pass active now: 1-day tickets (NwPassDays) use g.pass.until, else the fixed entitlement flag */
  passOn() { return this.S.NwPassDays ? this.g.pass.until > this.now : this.S.nwPass; }
  refreshStatus() { simRefreshStatus(this.st, this.m, this.g, this.u, { nwPass: this.passOn() }); }
  passExcludedBonus(type) { return this.st.getWorldTreeProductionBonus(type); }

  // ---- sessions
  sessionHours() { return this.S.OnlineHoursPerDay / Math.max(1, this.S.SessionStartHours.length); }
  /** TryGetSession @4166398 -> {inSession, sessEnd, nextStart} */
  tryGetSession(t) {
    const k = T.toKst(t), day0 = T.fromKst(k.y, k.mo, k.d);
    let nextStart = Infinity;
    for (let d = -1; d <= 1; d++) {
      for (const h of this.S.SessionStartHours) {
        const start = T.addHours(T.addDays(day0, d), h), end = T.addHours(start, this.sessionHours());
        if (t >= start && t < end) return { inSession: true, sessEnd: end, nextStart: start };
        if (start > t && start < nextStart) nextStart = start;
      }
    }
    return { inSession: false, sessEnd: 0, nextStart };
  }
  getFirstSessionStart() { return this.tryGetSession(this.start).inSession ? this.start : Math.min(this.tryGetSession(this.start).nextStart, this.end); }

  // ---- time advance
  processContent(t) {
    const { m, g, st } = this;
    t = Math.min(t, this.end);
    g.gameTime = t;
    try {
      this.bot.prepare(t);
      if (!this.contentPending()) require0(validateNewWorldContentProgress(Object.assign(g, { m, master: m }), st, 0, t, this.end), 'ValidateNewWorldContentProgress');
      if (g.Pioneers) refreshPioneersExternalEffects(g, st.pioneersExternalEffects);
      W.refreshArcDeviceBonus(m, g, st);
      require0(W.clock.prepareClockTowerProgress(m, g, st, 0, t, this.end), 'PrepareClockTowerProgress');
      require0(W.prepareNewWorldModeContent(m, g, st, t), 'PrepareNewWorldModeContent');
      let rc = W.syncWorldTree(m, g, st, 0, t, this.end, this.passExcludedBonus(300), this.passExcludedBonus(0x38e), true);
      for (let i = 0; rc === 0x134 && i < 100000; i++) rc = W.processNewWorldContentForVerification(m, g, st, 0, t, 0x1000);
      require0(rc, 'SyncWorldTree');
      W.refreshClockTowerRates(m, g, st);
      W.refreshNewWorldModeContentRates(m, g, st);
      if (g.Pioneers) refreshPioneersExternalEffects(g, st.pioneersExternalEffects);
    } finally { g.gameTime = this.now; }
  }
  advance(t, withIncome) {
    if (withIncome) this.bot.processPrecisely(t);
    this.processContent(t);
    if (withIncome) gold.addFieldIncome(this, this.now, t);
    this.setNow(t);
    if (this.S.NwPassDays && this.passOn() !== this.lastPassOn) { this.lastPassOn = !this.lastPassOn; this.refreshStatus(); }
  }

  refreshDaily() {
    const day = T.kstDayDiff(this.now, this.start);
    if (day === this.dayIndex) return;
    this.dayIndex = day;
    if (this.S.NwPassDays) {   // 1-day ticket: GameData.CheckNewWorldPassAmount @3bf4204: until = max(until, now) + 24 h (stacks)
      if (this.S.NwPassDays.includes(day)) { this.g.pass.until = Math.max(this.g.pass.until, this.now) + 86400000; this.passGems += this.S.NwPassDayGems; }
      this.S.nwPass = this.passOn();
      this.lastPassOn = this.S.nwPass;
      this.refreshStatus();
    }
    gems.dailyRewards(this);
    const rc = W.activateTimeRampage(this.m, this.g, this.now);
    if (rc) this.warn('rampage', rc);
    gems.spendGems(this, true);
  }

  tryRankUpsImpl() {
    const { m, g, st } = this;
    for (;;) {
      const r = g.rank;
      if (this.rankMax <= r || E.isRankUpAvailable(m, g, st, r + 1) !== 0) return;
      gold.spendGold(this, false);
      power.spendSurplusPower(this, NewWorldRankUpPower(m, r + 1, st).value);
      if (E.isRankUpAvailable(m, g, st, r + 1) !== 0) return;
      const prevMax = g.maxRank;
      require0(E.rankUp(m, g, st, this.constraints, r + 1), 'RankUp');
      for (let k = prevMax + 1; k <= g.maxRank; k++) {
        const row = m.tryGetNewWorldRank(k);
        if (row && row.Reward) gems.grantReward(this, row.Reward);
      }
      this.rankTimeline.push({ rank: g.rank, hours: T.totalHours(this.now - this.start) });
      gems.buyRankProducts(this, r + 1);
      this.refreshStatus();
    }
  }

  act() {
    power.processScienceFoundation(this);
    world.maintainClockTower(this);
    this.tryRankUps();
    gems.spendGems(this, false);
    world.spendWorldCrystal(this);
    this.bot.play();
    world.spendMana(this);
    power.spendScience(this);
    power.spendSoul(this);
    power.spendPower(this, false);
    gold.spendGold(this, true);
    gold.equipWeapons(this);
    gold.selectField(this);
    world.spendMana(this);
    world.tryGrowWorldTree(this);
    this.refreshStatus();
    this.tryRankUps();
    this.nextActionAt = T.addSeconds(this.now, this.S.ActionIntervalSeconds);
  }

  /** Step @41645f0 */
  step() {
    if (this.now >= this.end || this.g.rank >= this.rankMax) { this.isFinished = true; return; }
    const { inSession, sessEnd, nextStart } = this.tryGetSession(this.now);
    if (!inSession) {
      this.advance(Math.min(nextStart, this.end), false);
      if (this.now < this.end) { this.refreshDaily(); this.act(); }
      return;
    }
    const t = Math.min(T.addSeconds(this.now, this.S.StepSeconds), sessEnd, this.end);
    this.advance(t, true);
    this.refreshDaily(); this.tryRankUps();
    if (this.now >= this.nextActionAt || this.now >= sessEnd) this.act();
  }

  run() {
    this.setup();
    this.lastProgress = -1;
    for (let i = 0; !this.isFinished; i++) {
      if (i > 5e6) throw new Error('simulation did not terminate');
      this.step();
      if (this.onProgress) {
        const f = Math.min(1, (this.now - this.start) / (this.end - this.start));
        if (f >= this.lastProgress + 0.01 || this.isFinished) {
          this.lastProgress = f;
          this.onProgress(f, { finalRank: this.g.rank, elapsedHours: T.totalHours(this.now - this.start), rankTimeline: this.rankTimeline.slice() });
        }
      }
    }
    const done = this.g.rank >= this.rankMax;
    const gm = this.gem ?? {};
    return {
      reached: done, elapsedHours: T.totalHours(this.now - this.start), finalRank: this.g.rank, rankTimeline: this.rankTimeline,
      passGems: this.passGems, gemsSpent: gm.gemsVariable ?? 0, gemSpentDetail: gm.spentDetail ?? {}, warnings: this.warnings,
    };
  }
}


/**
 * Calculator entry point. opts: themeId, difficulty, goldenCardLevels {cardId: level}, memberships {ms_*: bool, nw_pass: bool},
 * nwPassDays (array of season day indexes 0..seasonDays-1 with a 1-day pass bought; overrides memberships.nw_pass), gemBudget, onlineHoursPerDay, seasonDays, includeAds, includeLimitedPackages, seed, eventNumber, settings (PascalCase overrides),
 * master (Master instance; required), onProgress(fraction 0..1, {finalRank, elapsedHours, rankTimeline}) called about every 1% of the season.
 */
export function createSim(opts = {}) {
  const S = defaultSettings();
  const map = { themeId: 'ThemeId', difficulty: 'Difficulty', gemBudget: 'GemBudget', onlineHoursPerDay: 'OnlineHoursPerDay', seasonDays: 'SeasonDays',
    includeAds: 'IncludeAds', includeLimitedPackages: 'IncludeLimitedPackages', seed: 'Seed', eventNumber: 'EventNumber' };
  for (const [k, v] of Object.entries(map)) if (opts[k] !== undefined) S[v] = opts[k];
  Object.assign(S, opts.settings);
  const memberships = Object.fromEntries([...NW_MEMBERSHIPS, 'nw_pass'].map((id) => [id, opts.memberships?.[id] ?? true]));
  S.nwPass = memberships.nw_pass;
  if (opts.nwPassDays) { S.NwPassDays = [...new Set(opts.nwPassDays)]; S.nwPass = false; }
  if (opts.gemPolicy) S.Policy = gems.createGemPolicy(opts.gemPolicy);
  const lv = opts.goldenCardLevels;
  const sim = new Sim(opts.master, S, { goldenCardLevels: lv, memberships });
  sim.onProgress = opts.onProgress;
  return sim;
}

export const runSimulation = (opts = {}) => createSim(opts).run();
