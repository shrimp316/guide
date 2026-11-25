// U3 part A: gold / power / weapons / fields / research / rank-up / content unlock (GameData + UserData), NewWorld mode 10.
// Ported from ARM64 disassembly (tools/disasm.py), addresses in each doc comment.
//
// CONVENTIONS (see game_state.js): fn(m, g, status, ...). m = Master, g = state, status = U2 UpgradeStatus (or null).
//   `constraints` = JS Map<int,int> (the sim's _constraints: 10 = LimitResearch, 0x16 = LimitField, 0x1e = LimitWeapon+1,
//   0x20 = restrict-to-weaponId, 0xb = "research blocked" when >0). Missing key reads as -1 (dict.GetValueOrDefault(k,-1) @496d514).
//   Return codes are the C# ints (0 ok, 1 = not enough gold, 0x12c already done, 0x386 bad arg, 0x67 weapon missing,
//   0x65 upgrade missing, 0x12d weapon not owned, 0x132 level cap, 0x32 tier locked, 0x3e8 not a research id, 0x6d bad field,
//   0x12f rank not next, 0x34 not enough power).
//
// EXPORTS
//   newEconState(m, opts?)      full initial state for NewWorld (mode 10): createCoreState + initGoldState + InitProgress
//                               defaults (field 1, unlocked 1, rank 1, tier 1) + InitPlay (5 empty slots) + Check (weapon 5001 lv1).
//                               opts: {themeId=90001, eventNumber=990001, difficulty=2, rankMax=m.newWorldRankMax, storeResearchTheme}
//   initGoldState(g, opts?)     idempotent field init (no gameplay defaults beyond zero/empty)
//   modifyGold(g, amt) @3b9a2a8        modifyPower(g, amt) @3ba0bbc  (ModifyPower also AddWorldTreePower @3ba3198, see below)
//   getWeaponData(g, id) -> {id, level} @3b99684 (level 0 = absent);  isBrought(wd) = level > 0 @3c43d6c
//   setWeapon(m, g, slot, id) -> int @3b99b68 (+ unequipWeapon(g, id) @3b99944)
//   setField(m, g, f) @3b98110, setAchievedField(m, g, f) @3c169cc, setClearedField(m, g, status, f) @3c178f4,
//   unlockField(m, g, f) @3c16c94
//   buyWeaponAssist(m, g, status, constraints) -> {code:0, count} @3b9aac8
//   enhanceWeapon(m, g, status, id, count=1) -> int @3b9b0d8
//   getResearchData(g, id) -> {id, level} @3c19450
//   research(m, g, status, constraints, id, count=1) -> int @3c1806c
//   refreshResearchState(m, g, status, constraints) @3b9790c, setTier(m, g, status, constraints, tier) @3b974bc
//   check(m, g, status, constraints) @3c37d90 (= RefreshResearchState + default weapons + soul clamp; CheckSecretArea omitted)
//   isRankUpAvailable(m, g, status, rank) -> int @3c18918 (0 = available), rankUp(m, g, status, constraints, rank, check=true,
//   skipStore=false) -> int @3c18b34 (+ setRank @3b984d8, setAchievedRank @3c1867c, onRankUp @3b955d0, storeNewWorldResearchBonuses @3c16144)
//   isUnlockedContents(m, g, id) -> bool (UserData.IsUnlockedContents @3b4a764); content ids 0x70 science / 0x71 arcane / 0x74 pioneers
//   refreshSpecial3WeaponCount(m, g) @3b97f80, isSingularityEnhanced(g, blockId) @3ba00b4
//   getTierTotalPrevResearchCount(m, tier) @4134a2c
//
// STATE FIELDS (g.*, GameData offsets)
//   mode(+0x410)=10  themeId(+0x420) eventNumber(+0x424) difficulty(+0x428)  rankMax (override of M.GetNewWorldRankMax)
//   gold(+0x4e8) goldPeak(+0x4f8) goldTotal(+0x508) goldTotal2=rank total(+0x518) goldTotal3(+0x528)   [core]
//   power(+0x538) powerPeak(+0x548) powerTotal(+0x558) powerRankTotal(+0x568) powerTotal3(+0x578)
//   weapons Map(id->level)(+0x458)  equipped int[5](+0x440)  weaponUnlockIndexAch(+0x448) weaponUnlockIndex(+0x44c)
//   special3WeaponCount(+0x450)
//   research Map(id->level)(+0x1440)  researchNonBasic(+0x1448)  researchTier [core] (+0x13fc)  storedResearchBonuses [{type,vt,value}] (+0x13b0)
//   field [core](+0x13d0)  field13dc(+0x13dc)  unlockedFields [core](+0x13d4)  achievedField(+0x13d8)  clearedField(+0x13f0)
//   bestGoldField(+0x13f4) bestRuneField(+0x13f8) clearedFields Set(+0x13e8)  singularityEnhanced Set(+0x15e8)
//   rank [core](+0x1400) maxRank [core](+0x1404)
//   worldTreeProcessing(+0x1338, the sim's AddPower reflection flag) wtProcessingPower(+0x12b8) wtPowerAccum(+0x1318)
//   noNewWorldContent(+0x13a8)  contentsUnlocked Set (non-NewWorld contents, UserData+0x408)
//   hooks.addWorldTreePower(g, amt)  optional U4 hook for the non-processing branch of AddWorldTreePower.
//
// KEY FINDINGS
//   * NewWorld RankUp is cheap: OnRankUp @3b955d0 returns right after resetting gold, power (and their rank-total counters) to 0
//     for mode 10 (`cmp mode,#0xa; b.eq epilogue` at 3b957c0); weapons, research, fields are NOT reset.
//   * Initial NewWorld state (InitProgress @3c1b01c): field 1, unlockedFields 1, achievedField 1, clearedField 1, researchTier 1,
//     rank 1 (maxRank 1), weapon 5001 level 1 (Check). Equipped list = 5 zero slots (InitPlay @3ba1940).
//   * BuyWeaponAssist walks the whole master Weapon list in sheet order (defaults included, so 5099 costs 1 gold if it is not
//     in the dict), buys every weapon whose price <= gold at that moment (no break), level 1.
//
// UNCERTAINTIES
//   * storeNewWorldResearchBonuses runs only when NewWorld[themeId].Theme equals a static string literal I could not read
//     (@3c162c8 slot 0x710); default 'nw_ice' (opts.storeResearchTheme). Result only feeds g.storedResearchBonuses (+0x13b0), which
//     nothing in U3 reads (U2 AddNewWorldThemeBonuses may). Percent factor assumed 0.01 (static double @+0xf58, unread).
//   * Content name -> id: new_world_science=0x70, new_world_arcane=0x71, new_world_pioneers=0x74 (by the sim's gates; the
//     name->id table is built in M.LoadNewWorldRank @3a24558, not decoded).
//   * GetRankMax(difficulty) = M.GetNewWorldRankMax (decompile stub): defaults to m.newWorldRankMax (20) unless g.rankMax is set.
//   * GetFieldMax(10) = m.fieldMax (103, derived), the sim limits fields to constraints[0x16] anyway.
//   * AddWorldTreePower non-processing branch (ProcessNewWorldBatches/ReserveWorldTreeGain, U4) is only a hook; the sim always
//     sets the processing flag around positive field-power gains so that branch is not exercised by U3/U6.
//   * IsBuyWeaponAssistAvailable/IsEquipWeaponAssistAvailable are report-only audit helpers in the sim: not ported.
import { BigNumber } from './bignum.js';
import { createCoreState } from './game_state.js';
import { NewWorldRankUpPower, ResearchCost, WeaponPrice, WeaponEnhanceCost, weaponSpecialGrade } from './expr_x.js';
import { getDataIdType } from './master.js';

const { ZERO, ONE } = BigNumber;
const DEFAULT_WEAPONS = [5001, 5099];
const cget = (c, k) => (c && c.has(k) ? c.get(k) : -1);          // dict.GetValueOrDefault(k, -1) @496d514
const bmax = (a, b) => (a.gt(b) ? a : b);                        // csel after op_GreaterThan(a, b)

export function initGoldState(g, opts = {}) {
  const d = {
    mode: 10, themeId: opts.themeId ?? 90001, eventNumber: opts.eventNumber ?? 990001, difficulty: opts.difficulty ?? 2,
    rankMax: opts.rankMax ?? null, storeResearchTheme: opts.storeResearchTheme ?? 'nw_ice',
    powerPeak: ZERO, powerTotal: ZERO, powerRankTotal: ZERO, powerTotal3: ZERO,
    weapons: new Map(), equipped: [0, 0, 0, 0, 0], weaponUnlockIndexAch: 0, weaponUnlockIndex: 0, special3WeaponCount: 0,
    research: new Map(), researchNonBasic: 0, storedResearchBonuses: [],
    field13dc: 0, achievedField: 0, clearedField: 0, bestGoldField: 0, bestRuneField: 0, clearedFields: new Set(),
    singularityEnhanced: new Set(),
    worldTreeProcessing: false, wtProcessingPower: ZERO, wtPowerAccum: ZERO, noNewWorldContent: false,
    contentsUnlocked: new Set(), hooks: {},
  };
  for (const k of Object.keys(d)) if (g[k] === undefined) g[k] = d[k];
  return g;
}

export function newEconState(m, opts = {}) {
  const g = initGoldState(createCoreState(), opts);
  // InitProgress @3c1b01c: smax(...,1) on (field, unlockedFields), achievedField, clearedField, (researchTier, rank), maxRank
  g.field = 1; g.unlockedFields = 1; g.achievedField = 1; g.clearedField = 1;
  g.researchTier = 1; g.rank = 1; g.maxRank = 1;
  g.weapons.set(5001, 1);                                   // Check @3c37d90
  return g;
}

// ---- gold / power -----------------------------------------------------------------------------------------------
/** GameData.ModifyGold @3b9a2a8 (amount may be negative = spend). */
export function modifyGold(g, amt) {
  amt = BigNumber.of(amt);
  g.gold = g.gold.add(amt);
  g.goldPeak = bmax(g.goldPeak, g.gold);
  g.goldTotal = bmax(g.goldTotal, g.goldPeak);
  if (amt.gt(ZERO)) { g.goldTotal = g.goldTotal.add(amt); g.goldTotal2 = g.goldTotal2.add(amt); g.goldTotal3 = g.goldTotal3.add(amt); }
}

/** GameData.AddWorldTreePower @3ba3198 (called first thing by ModifyPower). Only the flag branch is exact. */
function addWorldTreePower(g, amt) {
  if (amt.le(ZERO) || g.mode !== 10 || g.noNewWorldContent) return;
  if (g.worldTreeProcessing) { g.wtProcessingPower = g.wtProcessingPower.add(amt); return; }   // +0x1338 flag -> +0x12b8
  if (g.hooks.addWorldTreePower) g.hooks.addWorldTreePower(g, amt);
  else g.wtPowerAccum = g.wtPowerAccum.add(amt);                                                // approximation (+0x1318)
}

/** GameData.ModifyPower @3ba0bbc. */
export function modifyPower(g, amt) {
  amt = BigNumber.of(amt);
  addWorldTreePower(g, amt);
  g.power = g.power.add(amt);
  g.powerPeak = bmax(g.powerPeak, g.power);
  g.powerTotal = bmax(g.powerTotal, g.powerPeak);
  if (amt.gt(ZERO)) { g.powerTotal = g.powerTotal.add(amt); g.powerRankTotal = g.powerRankTotal.add(amt); g.powerTotal3 = g.powerTotal3.add(amt); }
}

// ---- weapons -----------------------------------------------------------------------------------------------------
export const getWeaponData = (g, id) => ({ id, level: g.weapons.get(id) ?? 0 });          // @3b99684
export const isBrought = (wd) => wd.level > 0;                                             // @3c43d6c

/** UnequipWeapon @3b99944: every slot holding id becomes 0. */
export function unequipWeapon(g, id) {
  for (let i = 0; i < g.equipped.length; i++) if (g.equipped[i] === id) g.equipped[i] = 0;
  return 0;
}

/** GameData.SetWeapon @3b99b68 (slot, weaponId). */
export function setWeapon(m, g, slot, id) {
  if (slot < 0 || slot >= 5) return 0x386;
  if (id >= 1) {
    if (!m.tryGetWeapon(id)) return 0x67;
    if (!isBrought(getWeaponData(g, id))) return 0x12d;
  } else id = 0;
  while (g.equipped.length < 5) g.equipped.push(0);
  unequipWeapon(g, id);
  g.equipped[slot] = id;
  return 0;
}

/** RefreshSpecial3WeaponCount @3b97f80: weapons whose GetWeaponSpecialGrade(level) >= 3. */
export function refreshSpecial3WeaponCount(m, g) {
  let n = 0;
  for (const lv of g.weapons.values()) if (weaponSpecialGrade(m, lv) >= 3) n++;
  g.special3WeaponCount = n;
}

/** GameData.BuyWeaponAssist @3b9aac8 (constraints, status, out count). Buys each unowned affordable weapon (level 1). */
export function buyWeaponAssist(m, g, status, constraints) {
  const limit = cget(constraints, 0x1e), only = cget(constraints, 0x20);
  const special = status ? status.getInt(0x3e8, 0) : 0;
  let count = 0, maxIdx = 0;
  for (const w of m.findAll('Weapon')) {
    const ui = w.UnlockIndex ?? 0;
    if (limit >= 0 && ui + 1 > limit) continue;
    if (only >= 0 && w.Id !== only) continue;
    const st = w.SpecialTier ?? 0;
    if (st >= 1 && st > special) continue;
    if (isBrought(getWeaponData(g, w.Id))) continue;
    const p = WeaponPrice(m, w.Id, status);
    if (p.code !== 0) continue;
    if (!g.gold.ge(p.value)) continue;
    modifyGold(g, p.value.neg());
    count++;
    g.weapons.set(w.Id, 1);
    maxIdx = Math.max(maxIdx, ui);
  }
  if (count >= 1) {
    g.weaponUnlockIndexAch = Math.max(g.weaponUnlockIndexAch, maxIdx);
    g.weaponUnlockIndex = Math.max(g.weaponUnlockIndex, maxIdx);
  }
  return { code: 0, count };
}

/** GameData.EnhanceWeapon @3b9b0d8 (id, status, count). Needs a status (status.getInt(0x20) = enhance cap). */
export function enhanceWeapon(m, g, status, id, count = 1) {
  const row = m.tryGetWeapon(id);
  if (!row) return 0x67;
  const wd = getWeaponData(g, id);
  if (!isBrought(wd)) return 0x12d;
  if (wd.level > status.getInt(0x20, 0)) return 0x132;
  const c = WeaponEnhanceCost(m, id, wd.level, status, g.gold, count);
  if (c.code !== 0) return c.code;
  if (g.gold.lt(c.value)) return 1;
  modifyGold(g, c.value.neg());
  g.weapons.set(id, wd.level + c.count);
  const ui = row.UnlockIndex ?? 0;
  if (g.weaponUnlockIndexAch < ui) g.weaponUnlockIndexAch = ui;
  g.weaponUnlockIndex = Math.max(g.weaponUnlockIndex, ui);
  refreshSpecial3WeaponCount(m, g);
  return 0;
}

// ---- fields ------------------------------------------------------------------------------------------------------
/** SetAchievedField @3c169cc. */
export function setAchievedField(m, g, f) {
  if (f < 1 || m.fieldMax < f) return 0x386;
  if (g.achievedField === f) return 0x12c;
  g.achievedField = f;
  return 0;
}

/** GameData.SetField @3b98110. */
export function setField(m, g, f) {
  if (f < 1 || m.fieldMax < f) return 0x386;
  g.field = f; g.field13dc = 0;
  if (g.achievedField < f) setAchievedField(m, g, f);
  return 0;
}

/** GameData.UnlockField @3c16c94 (pays Field.NewWorldPrice). */
export function unlockField(m, g, f) {
  const row = m.tryGetField(f);
  if (!row || m.fieldMax < f) return 0x6d;
  if (g.unlockedFields >= f) return 0x12c;
  const price = m.getFieldPrice(row, g.mode);
  if (g.gold.lt(price)) return 1;
  modifyGold(g, price.neg());
  g.unlockedFields = f;
  if (g.achievedField < f) setAchievedField(m, g, f);
  return 0;
}

export const isSingularityEnhanced = (g, blockId) => g.singularityEnhanced.has(blockId);   // @3ba00b4

/** GameData.SetClearedField @3c178f4 (field, status): best cleared / best-gold / best-rune field bookkeeping. */
export function setClearedField(m, g, status, f) {
  g.clearedField = Math.max(g.clearedField, f);
  const rowF = m.tryGetField(f);
  if (rowF) {
    const goldOf = (blk) => {
      let v = m.bn(blk, 'Reward');
      if (status) v = v.mul(status.get(1, ONE).mul(status.getBlockGoldBonus(blk.Id)));
      return v;
    };
    const rowB = m.tryGetField(g.bestGoldField < 1 ? g.clearedField : g.bestGoldField);
    if (rowB) {
      const bF = m.tryGetBlock(rowF.Block), bB = m.tryGetBlock(rowB.Block);
      if (bF && bB) {
        const a = goldOf(bF), b = goldOf(bB);
        if (a.gt(b) || (a.eq(b) && g.bestGoldField < f)) g.bestGoldField = f;
      }
    }
    const rowR = m.tryGetField(g.bestRuneField < 1 ? g.clearedField : g.bestRuneField);
    if (rowR) {
      const rune = (r) => (isSingularityEnhanced(g, r.Block) ? r.SingularityEnhancedRuneMine : r.RuneMine) ?? 0;
      const a = rune(rowF), b = rune(rowR);
      if (a > b || (a === b && g.bestRuneField < f)) g.bestRuneField = f;
    }
  }
  g.clearedFields.add(f);
  return 0;
}

// ---- research ----------------------------------------------------------------------------------------------------
export const getResearchData = (g, id) => ({ id, level: g.research.get(id) ?? 0 });        // @3c19450

const maxTier = (m) => (m._maxTier ??= Math.max(...m.sheet('Tier').map((r) => r.Tier)));    // M static +0x28 (derived)
const tierRow = (m, t) => m.sheet('Tier').find((r) => r.Tier === t) ?? null;                // Root.TryGetTier (dict +0x548)

/** Extensions GetTierTotalPrevResearchCount @4134a2c: sum of MaxLevel over non-basic 3xxx upgrades with Tier < tier. */
export function getTierTotalPrevResearchCount(m, tier) {
  m._tierPrev ??= new Map();
  let v = m._tierPrev.get(tier);
  if (v === undefined) {
    v = 0;
    for (const u of m.findAll('Upgrade')) {
      if (u.IsTierBasic) continue;
      if (((u.Id - 3000) >>> 0) >= 1000) continue;
      if ((u.Tier ?? 0) < tier) v += u.MaxLevel ?? 0;
    }
    m._tierPrev.set(tier, v);
  }
  return v;
}

/** GameData.Research @3c1806c (id, constraints, status, count). */
export function research(m, g, status, constraints, id, count = 1) {
  if (cget(constraints, 0xb) >= 1) return 0;
  const up = m.tryGetUpgrade(id);
  if (!up) return 0x65;
  if (g.researchTier < (up.Tier ?? 0)) return 0x32;
  if (getDataIdType(id) !== 3) return 0x3e8;
  const lv = getResearchData(g, id).level;
  if ((up.MaxLevel ?? 0) <= lv) return 0x132;
  const c = ResearchCost(m, id, lv, status, g.gold, count);
  if (c.code !== 0) return c.code;
  if (g.gold.lt(c.value)) return 1;
  modifyGold(g, c.value.neg());
  g.research.set(id, lv + c.count);
  if (!up.IsTierBasic) refreshResearchState(m, g, status, constraints);
  return 0;
}

/** GameData.SetTier @3b974bc: sets the tier, then auto-researches (1 gold each if affordable) every unowned tier-basic upgrade. */
export function setTier(m, g, status, constraints, tier) {
  if (tier < 1 || maxTier(m) < tier) return 0x386;
  g.researchTier = tier;
  for (const u of m.findAll('Upgrade')) {
    if ((u.Tier ?? 0) > g.researchTier || !u.IsTierBasic || g.research.has(u.Id)) continue;
    research(m, g, null, constraints, u.Id, 1);
  }
  return 0;
}

/** GameData.RefreshResearchState @3b9790c: recount non-basic levels, advance researchTier while the Tier table allows. */
export function refreshResearchState(m, g, status, constraints) {
  g.researchNonBasic = 0;
  for (const [id, lv] of g.research) {
    const u = m.tryGetUpgrade(id);
    if (u && !u.IsTierBasic) g.researchNonBasic += lv;
  }
  let cap;
  const c10 = cget(constraints, 10), c11 = cget(constraints, 0xb);
  if (constraints && c11 > 0) cap = 0;
  else cap = c10 >= 0 ? c10 : maxTier(m);
  const special = status ? status.getInt(0x3e8, 0) : 0;
  while (g.researchTier + 1 <= cap) {
    const row = tierRow(m, g.researchTier + 1);
    if (!row) break;
    const st = row.SpecialTier ?? 0;
    if (st >= 1 && st > special) break;
    if (g.researchNonBasic < getTierTotalPrevResearchCount(m, row.Tier) - (row.Research ?? 0)) break;
    setTier(m, g, status, constraints, row.Tier);
  }
}

/** GameData.Check @3c37d90 (constraints, status). */
export function check(m, g, status, constraints) {
  refreshResearchState(m, g, status, constraints);
  if (g.soulUpgrade) for (const id of DEFAULT_WEAPONS) g.soulUpgrade.delete(id);
  g.weapons.set(5001, 1);
  if (g.weapons.has(5099)) g.weapons.set(5099, 1);
  if (g.soulEnhance) {                                         // clamp soul-enhance levels to status 0xcb (default 1)
    const max = status ? status.getInt(0xcb, 1) : 1;
    for (const w of m.findAll('Weapon')) {
      const e = g.soulEnhance.get(w.Id);
      if (!e) continue;
      const a = Math.min(e.a, max), b = Math.min(e.b, max);
      if (a || b) g.soulEnhance.set(w.Id, { ...e, a, b }); else g.soulEnhance.delete(w.Id);
    }
  }
}

// ---- rank-up -----------------------------------------------------------------------------------------------------
const rankLimit = (m, g) => g.rankMax ?? m.newWorldRankMax;                // GetRankMax @3c185f0 -> M.GetNewWorldRankMax

/** GameData.IsRankUpAvailable @3c18918 (NewWorld branch). 0 = available. */
export function isRankUpAvailable(m, g, status, rank) {
  if (g.rank >= rank) return 0x12c;
  if (g.rank + 1 !== rank) return 0x12f;
  if (rankLimit(m, g) < rank) return 0x386;
  const p = NewWorldRankUpPower(m, rank, status);
  if (p.code !== 0) return p.code;
  return g.power.lt(p.value) ? 0x34 : 0;
}

/** SetAchievedRank @3c1867c */
function setAchievedRank(m, g, r) {
  if (r < 1 || rankLimit(m, g) < r) return 0x386;
  if (g.maxRank === r) return 0x12c;
  g.maxRank = r;
  return 0;
}
/** SetRank @3b984d8 */
function setRank(m, g, r) {
  if (r < 1 || rankLimit(m, g) < r) return 0x386;
  g.rank = r;
  if (g.maxRank < r) setAchievedRank(m, g, r);
  return 0;
}

/** GameData.OnRankUp @3b955d0, mode 10: SetGold/SetGoldTotalRank/SetPower/SetPowerTotalRank(Zero), nothing else. */
function onRankUp(g) {
  g.gold = ZERO; g.goldPeak = bmax(g.goldPeak, ZERO);                              // SetGold @3b960f0
  g.goldTotal2 = ZERO; g.goldPeak = bmax(g.goldPeak, ZERO);                        // SetGoldTotalRank @3b962ec (+0x518)
  g.power = ZERO; g.powerPeak = bmax(g.powerPeak, ZERO);                           // SetPower @3b964e8
  g.powerRankTotal = ZERO; g.powerPeak = bmax(g.powerPeak, ZERO);                  // SetPowerTotalRank @3b966e4 (+0x568)
}

/** Upgrade.GetValue @415c934: base/up^lv (type 4), base*up^lv (3), else base + up*lv. */
function upgradeValue(up, i, lv) {
  const base = new BigNumber(up.ValueList?.[i] ?? 0), step = new BigNumber(up.ValueUpList?.[i] ?? 0), t = up.ValueUpType ?? 0;
  if (t === 4) return base.div(step.pow(lv));
  if (t === 3) return base.mul(step.pow(lv));
  return base.add(step.mul(lv));
}

/** GameData.StoreNewWorldResearchBonuses @3c16144 (see UNCERTAINTIES): accumulates tier>=BonusParam1 tier-basic research effects. */
export function storeNewWorldResearchBonuses(m, g) {
  if (g.mode !== 10 || g.noNewWorldContent) return;
  const nw = m.tryGetNewWorld(g.themeId);
  if (!nw || nw.Theme !== g.storeResearchTheme) return;
  const p1 = nw.BonusParam1 ?? 0;
  for (const [id, lv] of g.research) {
    if (lv < 1) continue;
    const up = m.tryGetUpgrade(id);
    if (!up || !up.IsTierBasic || p1 > (up.Tier ?? 0)) continue;
    const types = up.TypeList ?? [];
    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      if (type === 0) continue;
      let v = upgradeValue(up, i, lv), vt = up.ValueType ?? 0;
      if (vt === 2) { v = ONE.add(v.mul(0.01)); vt = 3; }
      else if (vt === 4) { v = v.reciprocal(); vt = 3; }
      else if (vt !== 1 && vt !== 3) continue;
      const e = g.storedResearchBonuses.find((x) => x.type === type && x.vt === vt);
      if (e) e.value = vt === 1 ? e.value.add(v) : e.value.mul(v);
      else g.storedResearchBonuses.push({ type, vt, value: v });
    }
  }
}

/** GameData.RankUp @3c18b34 (check, rank, skip, constraints, status). */
export function rankUp(m, g, status, constraints, rank, check = true, skipStore = false) {
  if (check) { const c = isRankUpAvailable(m, g, status, rank); if (c) return c; }
  const old = g.rank;
  const c = setRank(m, g, rank);
  if (c) return c;
  if (!skipStore) {
    if (old < rank) storeNewWorldResearchBonuses(m, g);
    onRankUp(g);
  }
  return 0;
}

// ---- content unlock ----------------------------------------------------------------------------------------------
const CONTENT_ID = { new_world_science: 0x70, new_world_arcane: 0x71, new_world_pioneers: 0x74 };
function contentUnlockRank(m, id) {                                   // M.TryGetNewWorldContentUnlockRank @3a50acc
  if (!m._contentRank) {
    m._contentRank = new Map();
    for (const r of m.findAll('NewWorldRank')) for (const n of r.UnlockContents ?? []) if (CONTENT_ID[n] !== undefined) m._contentRank.set(CONTENT_ID[n], r.Rank);
  }
  return m._contentRank.get(id) ?? null;
}

/** UserData.IsUnlockedContents @3b4a764. */
export function isUnlockedContents(m, g, id) {
  const rank = contentUnlockRank(m, id);
  if (rank !== null) return g.mode === 10 && !g.noNewWorldContent && g.maxRank >= rank;
  if (id === 0) return true;
  return g.contentsUnlocked.has(id);
}
