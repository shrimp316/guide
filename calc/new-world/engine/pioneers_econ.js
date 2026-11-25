// U5-B: Pioneers costs / quotes / jobs / research / conversion / bonus (GameData + Pioneers statics). All from disassembly (hex addrs).
// Convention: fn(g, ...) with g = GameData-like object. Needs: g.m (U1 Master), g.Pioneers (state, pioneers_state.js), g.PioneersIngots / g.PioneersManaStone
// (BigNumber), g.GameMode (10), g.PioneersDisabled (+0x13a8), and the resource interface (see U5_B_NOTES.md):
//   g.getBalance(id) -> BigNumber     id 100 gold, 101 power, 102 soul, 105 science point, 153 mana
//   g.modifyBalance(id, deltaBN)      (ModifyGold/Power/Soul/SciencePoint/Mana)
// Cross-part functions that live in U5-C (routes, carts) are reached through `procHooks` (set by pioneers.js).
import { BigNumber } from './bignum.js';
import { UpgradeStatus } from './upgrade_status.js';
import { E_TERRAIN, E_FACILITY } from './pioneers_state.js';
import { hooks, neighbor, pioneersTile, zones, weather, ground, getPioneersCalculationTime } from './pioneers_map.js';

const { ZERO, ONE } = BigNumber;
const bn = (x) => (x instanceof BigNumber ? x : new BigNumber(x));
const parseBN = (s) => BigNumber.parse(s ?? '');
const FAC = E_FACILITY;

/** U5-C functions called from here (assign in pioneers.js): refreshPioneersRoutes(g) @3bf98ec, synchronizePioneersCarts(g) @3bfef20,
 *  refreshPioneersDockedCartGround(g) @3bfe880, clearCaches(g) = Clear of the dictionaries at GameData+0x1238/+0x1240/+0x1260. */
export const procHooks = { refreshPioneersRoutes: null, synchronizePioneersCarts: null, refreshPioneersDockedCartGround: null, clearCaches: null };

/** Effect (UpgradeType) ids kept in the Pioneers effect status: static int[12] built in Pioneers..cctor @41a139c (assumed 920..931). */
export const PIONEERS_EFFECT_TYPES = [920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931];
export const EFFECT = { BUILD_TIME: 920, CLEAR_TIME: 921, EXPLORE_TIME: 922, DOCK_TIME: 923, BURN_TIME: 924, EXTRACT: 925, CART_CAPACITY: 926,
  BURN_AMOUNT: 927, MAGIC: 928, SHRINE: 929, WEATHER_CART_SPEED: 930, POINT_BONUS: 931 };
// NOTE: hex ids used in code: 0x398=920 build, 0x399=921 clear, 0x39a=922 explore, 0x39b=923 dock(load/unload), 0x39c=924 burn, 0x39d=925 extract,
// 0x39e=926 cart capacity, 0x39f=927 burn amount, 0x3a0=928 magic circle, 0x3a1=929 shrine, 0x3a2=930 cart speed (weather), 0x3a3=931 point bonus.

// ======================= Pioneers statics =======================
const FAC_TABLE = [93001, 93002, 93003, 93004, 0, 0, 93001, 93002, 93003, 93004];
/** Pioneers.GetFacilityId @419dcb4 (job type 1..10 -> facility id). */
export const getFacilityId = (t) => (t >= 1 && t <= 10 ? FAC_TABLE[t - 1] : 0);
/** Pioneers.IsFacilityUpgrade @419dcd8 */
export const isFacilityUpgrade = (t) => (t >= 7 && t <= 10);
/** Pioneers.GetJobQueue @419dd6c: explore 1, forest 2, everything else 0 */
export const getJobQueue = (t) => (t === 5 ? 1 : t === 6 ? 2 : 0);
/** Pioneers.IsSameJobQueue @419dce8 */
export function isSameJobQueue(a, b) {
  if (a === 5) return b === 5;
  if (b === 5) return false;
  return (a === 6) !== (b !== 6);
}
/** Pioneers.PowInteger @419dd84 (square & multiply with BigNumber.Multiply; negative exponent throws) */
export function powInteger(base, exp) {
  if (exp < 0) throw new RangeError('PowInteger: exp < 0');
  let acc = ONE, b = bn(base), n = exp;
  while (n !== 0) {
    if (n & 1) acc = acc.mul(b);
    if (n === 1) break;
    b = b.mul(b); n >>>= 1;
  }
  return acc;
}
/** Pioneers.Ceiling @419decc: value<=0 or exponent>=5 unchanged, else ceil(m*1000^e) */
export function ceiling(v) {
  if (v.le(ZERO) || v.e >= 5) return v;
  return new BigNumber(Math.ceil(Math.pow(1000, v.e) * v.m));
}
/** Pioneers.Round @419dfc8: Math.Round(m*1000^e, 0, AwayFromZero) for exponent < 5 */
export function round(v) {
  if (v.e >= 5) return v;
  const d = Math.pow(1000, v.e) * v.m;
  return new BigNumber(Math.sign(d) * Math.round(Math.abs(d)));
}
/** Pioneers.Value @419e0bc: type 1 additive (base + max(0,level-1)*up), otherwise geometric (base * up^max(0,level-1)) */
export function value(vt, level, base, up) {
  const n = Math.max(0, level - 1);
  if (vt === 1) return new BigNumber(base).add(n * up);
  return new BigNumber(base).mul(new BigNumber(up).pow(n));
}
/** Pioneers.FacilityValue @419e234 (row missing -> One) */
export function facilityValue(g, id, level) {
  const r = g.m.tryGet('PioneersFacility', id);
  if (!r) return ONE;
  return value(r.ValueType ?? 0, Math.max(1, level), r.BaseValue ?? 0, r.ValueUp ?? 0);
}
/** Pioneers.UpgradeValue @419e3f4 (tile.UpgradeLevels[id]+1) */
export function upgradeValue(g, tile, id) {
  const r = g.m.tryGet('PioneersUpgrade', id);
  if (!r) return ONE;
  return value(r.ValueType ?? 0, (tile.UpgradeLevels.get(id) ?? 0) + 1, r.BaseValue ?? 0, r.ValueUp ?? 0);
}
/** Pioneers.EffectDefault @419e5a4: dock/burn time effects (923,924) default 0, everything else 1 */
export const effectDefault = (t) => (t === 923 || t === 924 ? ZERO : ONE);
/** Pioneers.ResearchUpgradeValue @419e634: ValueUpType 4: v/up^lv, 3: v*up^lv, else v+up*lv */
export function researchUpgradeValue(row, level) {
  const v = new BigNumber(row.Value ?? 0), up = new BigNumber(row.ValueUp ?? 0);
  const t = row.ValueUpType ?? 0;
  if (t === 4) return v.div(up.pow(level));
  if (t === 3) return v.mul(up.pow(level));
  return v.add(up.mul(level));
}
/** Pioneers.MinimumSeconds @419e7b8: max MinSeconds over research rows with that UpgradeType (start 0) */
export function minimumSeconds(g, type) {
  let d = 0;
  for (const r of g.m.findAll('PioneersResearch')) if ((r.UpgradeType ?? 0) === type) d = Math.max(d, r.MinSeconds ?? 0);
  return d;
}
/** Pioneers.Seconds @419e9bc: dock/burn (923/924): secs+effect, else secs*effect; floored at MinimumSeconds */
export function seconds(g, secs, effects, type) {
  const e = effects.get(type, effectDefault(type)).toDouble();
  const min = minimumSeconds(g, type);
  const v = (type === 923 || type === 924) ? secs + e : secs * e;
  return Math.max(min, v);
}

// ======================= effects status =======================
const extGet = (ext, t) => (ext ? (ext instanceof Map ? ext.get(t) : ext.get?.(t)) : undefined);

/** GameData.get_PioneersEffectSources @3bf493c: Progress override (+0xa0) or GameData+0x1288 */
export function getPioneersEffectSources(g) {
  const S = g.Pioneers;
  return (S && S.Progress && S.Progress.ExternalEffects) || (g.PioneersExternalEffects ??= new Map());
}
/** UpgradeStatus.AddPioneersEffects @3b0573c: research levels (preview aware) + weather bonuses added into `status` via AddBonus */
export function addPioneersEffects(g, status, S, time, previewId, previewLevel, override) {
  for (const row of g.m.findAll('PioneersResearch')) {
    const lvl = (previewLevel >= 0 && row.Id === previewId) ? previewLevel : (S.ResearchLevels.get(row.Id) ?? 0);
    if (lvl < 1) continue;
    const type = row.UpgradeType ?? 0;
    if (type === 0) continue;
    status.addBonus(type, row.ValueType ?? 0, researchUpgradeValue(row, lvl));
  }
  const w = weather(g, S, time);
  if (!(override > 0) && w.Beyond) return;
  const row = g.m.tryGet('PioneersWeather', override > 0 ? override : w.Id);
  if (!row) return;
  const T = row.TypeList ?? [];
  for (let i = 0; i < T.length; i++) status.addBonus(T[i], row.ValueTypeList[i], new BigNumber(row.ValueList[i]));
}
/** UpgradeStatus.RefreshPioneersEffects @3b05510: reset to external effects (or defaults) then AddPioneersEffects */
export function refreshPioneersEffects(g, status, S, time, external, previewId = 0, previewLevel = -1, override = 0) {
  status.upgrades.clear();
  for (const t of PIONEERS_EFFECT_TYPES) {
    const v = extGet(external, t);
    status.upgrades.set(t, v !== undefined ? v : effectDefault(t));
  }
  addPioneersEffects(g, status, S, time, previewId, previewLevel, override);
}
/** GameData.PioneersEffects @3bf94f4: cached effect status, rebuilt when dirty (g.PioneersWeatherDirty = +0x12a0) or the weather id changed */
export function pioneersEffects(g) {
  const S = g.Pioneers;
  const w = weather(g, S, getPioneersCalculationTime(g));
  const wid = w.Beyond ? 0 : w.Id;
  let st = g.PioneersEffectsStatus;
  if (st && !g.PioneersWeatherDirty && g.PioneersEffectsWeather === wid) return st;
  st ??= (g.PioneersEffectsStatus = new UpgradeStatus(g.m));
  refreshPioneersEffects(g, st, S, getPioneersCalculationTime(g), getPioneersEffectSources(g), 0, -1, 0);
  g.PioneersEffectsWeather = wid;
  g.PioneersWeatherDirty = false;
  return st;
}
/** GameData.PioneersPreviewEffects @3bf9658 (shared scratch status @+0x1298) */
export function pioneersPreviewEffects(g, time, id, level, override = 0) {
  const st = (g.PioneersPreviewStatus ??= new UpgradeStatus(g.m));
  refreshPioneersEffects(g, st, g.Pioneers, time, getPioneersEffectSources(g), id, level, override);
  return st;
}
/** GameData.PioneersEffect @3bf8784 */
export const pioneersEffect = (g, type) => pioneersEffects(g).get(type, effectDefault(type));
/** GameData.PioneersSeconds @3bf9730 */
export const pioneersSeconds = (g, secs, type) => seconds(g, secs, pioneersEffects(g), type);
/** GameData.GetPioneersWeather @3bf916c */
export const getPioneersWeather = (g, time) => weather(g, g.Pioneers, time);

// ======================= levels, resources =======================
/** GetPioneersConversionLevel @3bf82ac / GetPioneersResearchLevel @3bf831c */
export const getPioneersConversionLevel = (g, id) => (id >= 1 && g.Pioneers ? (g.Pioneers.ConversionLevels.get(id) ?? 0) : 0);
export const getPioneersResearchLevel = (g, id) => (id >= 1 && g.Pioneers ? (g.Pioneers.ResearchLevels.get(id) ?? 0) : 0);
const jobCount = (S, type) => S.X70.get(type) ?? 0;   // StateData+0x70: per job type, number of jobs started (Start +1, Cancel/Release -1)

/** PioneersSource @3bf9e34: balance of a conversion/research cost resource (100,101,102,105,153), else Zero */
export function pioneersSource(g, id) {
  return id === 100 || id === 101 || id === 102 || id === 105 || id === 153 ? g.getBalance(id) : ZERO;
}
/** PioneersSourceError @3bf9f0c: Status code when `id` can't pay */
export function pioneersSourceError(id) {
  switch (id) { case 100: return 1; case 101: return 0x34; case 102: return 4; case 105: return 0x36; case 153: return 0x25; default: return 0x384; }
}
/** SpendPioneersSource @3bf9f6c (ModifyGold/Power/Soul/SciencePoint/Mana(-amount)) */
export function spendPioneersSource(g, id, amount) {
  if (id === 100 || id === 101 || id === 102 || id === 105 || id === 153) g.modifyBalance(id, bn(amount).neg());
}
/** ModifyPioneersIngots @3bf8024 / ModifyPioneersManaStone @3bf8168 (no clamp; event dispatch omitted) */
export function modifyPioneersIngots(g, d) { g.PioneersIngots = (g.PioneersIngots ?? ZERO).add(d); }
export function modifyPioneersManaStone(g, d) { g.PioneersManaStone = (g.PioneersManaStone ?? ZERO).add(d); }

/** CanChangePioneers @3bf9844: state exists, no progress snapshot, not mid-operation (+0x1228 / +0x1229), not disabled (+0x13a8), mode 10, not ended */
export function canChangePioneers(g) {
  const S = g.Pioneers;
  if (!S || S.Progress) return false;
  if (g.PioneersBusy || g.PioneersLocked || g.PioneersDisabled) return false;
  if (g.GameMode !== 10) return false;
  return S.Timestamp < S.EndAt;
}

// ======================= effects of buildings =======================
/** PioneersUpgradeMatches @3bfc6a0: magic-circle upgrades need a magic-land tile (Terrain 3) with MagicLevel>0; others need the same building */
export function pioneersUpgradeMatches(g, tile, id) {
  const row = g.m.tryGet('PioneersUpgrade', id);
  if (!row) return false;
  if (row.FacilityId === FAC.MAGIC_CIRCLE) return !!tile && tile.Terrain === E_TERRAIN.MAGIC && tile.MagicLevel > 0;
  return !!tile && tile.BuildingId !== 0 && tile.BuildingId === row.FacilityId;
}
/** PioneersUpgradeEffect @3bfc7dc (value at `level`): 94003 cart speed (*CartSpeed*eff930), 94004 capacity (*eff926, rounded), 94006 burn (*eff927) */
export function pioneersUpgradeEffect(g, id, level) {
  const row = g.m.tryGet('PioneersUpgrade', id);
  if (!row) return ONE;
  const v = value(row.ValueType ?? 0, level + 1, row.BaseValue ?? 0, row.ValueUp ?? 0);
  if (id === 94003) return v.mul(g.m.setting('PioneersSetting').CartSpeed ?? 0).mul(pioneersEffect(g, 930));
  if (id === 94006) return v.mul(pioneersEffect(g, 927));
  if (id === 94004) return round(v.mul(pioneersEffect(g, 926)));
  return v;
}
/** PioneersFacilityEffect @3bfcb28 */
export function pioneersFacilityEffect(g, tile, fac, level) {
  const v = facilityValue(g, fac, level);
  const s = g.m.setting('PioneersSetting');
  if (fac === FAC.MAGIC_CIRCLE) return v.mul(pioneersEffect(g, 928));
  if (fac === FAC.SHRINE) return v.mul(pioneersEffect(g, 929));
  if (fac === FAC.EXTRACTOR) {
    const rate = tile.OreId === -1 ? s.ManaExtractionRate : s.BonusExtractionRate;
    return v.mul(rate ?? 0).mul(pioneersEffect(g, 925));
  }
  return v;
}
/** PioneersFacilityIngot @3bfcdbc: ingots refunded when demolishing (build + upgrades of the facility + tile upgrade levels of that facility) */
export function pioneersFacilityIngot(g, tile, fac, level) {
  let total = ZERO;
  if (level < 1) return total;
  const r = g.m.tryGet('PioneersFacility', fac);
  if (!r) return total;
  total = new BigNumber(r.BuildIngot ?? 0);
  for (let k = 0; k < level - 1; k++) total = total.add(new BigNumber(r.UpgradeIngot ?? 0).add(new BigNumber(r.UpgradeIngotStep ?? 0).mul(k)));
  for (const [uid, ulv] of tile.UpgradeLevels) {
    const u = g.m.tryGet('PioneersUpgrade', uid);
    if (!u || u.FacilityId !== fac || ulv < 1) continue;
    for (let k = 0; k < ulv; k++) total = total.add(new BigNumber(u.Ingot ?? 0).add(new BigNumber(u.IngotUp ?? 0).mul(k)));
  }
  return total;
}
/** PioneersReservationStoneCost @3bfd298: explore (5) Exploration cost*up^n; forest (6) ceil(ForestCost*up^n); else 0. n = jobs of that type started */
export function pioneersReservationStoneCost(g, type, n) {
  const s = g.m.setting('PioneersSetting');
  if (type === 5) return parseBN(s.ExplorationCost).mul(new BigNumber(s.ExplorationCostUp ?? 0).pow(n));
  if (type === 6) return ceiling(parseBN(s.ForestCost).mul(new BigNumber(s.ForestCostUp ?? 0).pow(n)));
  return ZERO;
}
/** PioneersJobSeconds @3bfd528 (count = jobs of this type started before; level = current level for upgrades) */
export function pioneersJobSeconds(g, type, tile, count, level) {
  const s = g.m.setting('PioneersSetting');
  let base, up, n, eff;
  if (type === 5) { base = s.ExplorationSeconds; up = s.ExplorationSecondsUp; n = count; eff = 922; }
  else if (type === 6) {
    const a = s.ForestClearSeconds ?? [];
    base = a[Math.min(tile.ForestType, a.length - 1)] ?? 0; up = s.ForestClearSecondsUp; n = count; eff = 921;
  } else {
    const r = g.m.tryGet('PioneersFacility', getFacilityId(type));
    if (!r) return 0;
    if (isFacilityUpgrade(type)) { base = r.UpgradeSeconds; up = r.UpgradeSecondsUp; n = Math.max(0, level - 1); }
    else { base = r.BuildSeconds; up = r.BuildSecondsUp; n = count; }
    eff = 920;
  }
  return pioneersSeconds(g, (base ?? 0) * Math.pow(up ?? 0, n), eff);
}

// ======================= quote =======================
const newQuote = () => ({
  Status: 0,            // +0x00  0 ok; 900 invalid; 0x2d ingots short; 0x2e stones short; 0x25 mana short; 0x132 max level; 0x134 busy; 0x24c no revealed neighbour
  IngotCost: ZERO,      // +0x08
  StoneCost: ZERO,      // +0x18
  ManaCost: ZERO,       // +0x28
  Cost: ZERO,           // +0x38  (type 13: conversion cost of one purchase)
  Source: 0,            // +0x48  (type 13: cost resource id; type 14/15: tile.JobId)
  Count: 0,             // +0x4c
  Refund: ZERO,         // +0x50  (type 14/15: ingots returned)
  Seconds: 0,           // +0x60  job duration
  Level: 0,             // +0x68  current level
  MaxLevel: 0,          // +0x6c
  Effect: ZERO,         // +0x70  value at current level
  NextEffect: ZERO,     // +0x80  value at level+1
  AtMax: false,         // +0x90
  get Allowed() { return this.Status === 0; },    // PioneersQuote.get_Allowed @3c57060
});

function resourceStatus(g, q) {            // LAB_03bfc370: ingots, then stones, then mana
  if (q.IngotCost.gt(g.PioneersIngots ?? ZERO)) return 0x2d;
  if (q.StoneCost.gt(g.PioneersManaStone ?? ZERO)) return 0x2e;
  if (q.ManaCost.gt(g.getBalance(153))) return 0x25;
  return 0;
}
const statusWithMax = (g, q, busy) => {     // LAB_03bfc324 / LAB_03bfc30c
  if (q.MaxLevel > 0) {
    q.AtMax = q.MaxLevel <= q.Level;
    return q.Level < q.MaxLevel ? (busy ? 0x134 : resourceStatus(g, q)) : 0x132;
  }
  return busy ? 0x134 : resourceStatus(g, q);
};
const zonesOf = (g) => (g.PioneersZones ??= zones(g.Pioneers));

/**
 * GameData.GetPioneersQuote @3bfa7b4 (g, type, cell, id) -> quote.
 * type: 1 extractor, 2 shrine, 3 road, 4 magic circle (build); 5 explore; 6 clear forest; 7..10 upgrade extractor/shrine/road/magic circle;
 * 11 tile upgrade `id` (instant); 12 research `id` (cell -1); 13 conversion `id` (cell -1); 14 demolish road; 15 demolish shrine.
 */
export function getPioneersQuote(g, type, cell, id = 0) {
  const q = newQuote();
  const fail = (st = 900) => { q.Status = st; return q; };
  const S = g.Pioneers;
  if (!S || g.PioneersDisabled) return fail();
  if (S.Timestamp >= S.EndAt) return fail();
  const tile = pioneersTile(g, cell);
  const setting = g.m.setting('PioneersSetting');

  if (type === 11) {
    if (!tile || id < 1 || !tile.Revealed) return fail();
    const row = g.m.tryGet('PioneersUpgrade', id);
    if (!row || !pioneersUpgradeMatches(g, tile, id)) return fail();
    const lvl = tile.UpgradeLevels.get(id) ?? 0;
    q.Level = lvl; q.MaxLevel = row.MaxLevel ?? 0;
    q.IngotCost = new BigNumber(row.Ingot ?? 0).add(new BigNumber(row.IngotUp ?? 0).mul(lvl));
    q.StoneCost = ceiling(parseBN(row.Stone).mul(new BigNumber(row.StoneUp ?? 0).pow(lvl)));
    q.Effect = pioneersUpgradeEffect(g, id, lvl);
    q.NextEffect = pioneersUpgradeEffect(g, id, lvl + 1);
    q.Status = q.MaxLevel < 1 ? resourceStatus(g, q) : statusWithMax(g, q, false);
    return q;
  }
  if (type === 12) {
    if (!(id > 0)) return fail();
    const row = g.m.tryGet('PioneersResearch', id);
    if (!row) return fail();
    const lvl = getPioneersResearchLevel(g, id);
    let max = row.MaxLevel ?? 0;
    const eff = pioneersEffects(g);
    const prev = pioneersPreviewEffects(g, getPioneersCalculationTime(g), id, lvl + 1, 0);
    const ut = row.UpgradeType ?? 0;
    if (ut === 923 || ut === 924) {
      const base = ut === 923 ? Math.max(setting.LoadSeconds ?? 0, setting.UnloadSeconds ?? 0) : (setting.BurnSeconds ?? 0);
      if ((row.ValueType ?? 0) === 1) {
        const vut = row.ValueUpType ?? 0;
        if (!(vut === 3 || vut === 4)) {
          const vu = row.ValueUp ?? 0;
          if (vu < 0) {
            const cur0 = lvl < 1 ? ZERO : researchUpgradeValue(row, lvl);
            const other = eff.get(ut, ZERO).sub(cur0).toDouble();
            const v = Math.max(0, Math.trunc((base + other + (row.Value ?? 0) - minimumSeconds(g, ut)) / -vu));
            if (v < max) max = Math.trunc(v);
          }
        }
      }
      q.Effect = new BigNumber(seconds(g, base, eff, ut));
      q.NextEffect = new BigNumber(seconds(g, base, prev, ut));
    } else {
      q.Effect = eff.get(ut, effectDefault(ut));
      q.NextEffect = prev.get(ut, effectDefault(ut));
    }
    q.Level = lvl; q.MaxLevel = max;
    q.ManaCost = parseBN(row.Mana).mul(new BigNumber(row.ManaUp ?? 0).pow(lvl));
    q.StoneCost = ceiling(parseBN(row.Stone).mul(new BigNumber(row.StoneUp ?? 0).pow(lvl)));
    q.AtMax = q.MaxLevel <= q.Level;                 // always goes through LAB_03bfc324 (even when max < 1)
    q.Status = q.Level < q.MaxLevel ? resourceStatus(g, q) : 0x132;
    return q;
  }
  if (type === 13) {
    if (id < 1) return fail();
    const row = g.m.tryGet('PioneersConversion', id);
    if (!row) return fail();
    const lvl = getPioneersConversionLevel(g, id);
    const costType = row.CostType ?? 0;
    q.Cost = parseBN(row.Cost).mul(powInteger(new BigNumber(row.CostUp ?? 0), lvl));
    q.Effect = getPioneersConversionBonus(g, row.MilestoneType ?? 0);
    const iv = row.MilestoneInterval ?? 0;
    const ms = iv > 0 && (lvl + 1) % iv === 0 ? (row.MilestoneValue ?? 0) : 0;
    q.NextEffect = q.Effect.add(ms);
    q.Level = lvl; q.Source = costType;
    if (pioneersSource(g, costType).ge(q.Cost)) q.Status = 0;
    else q.Status = pioneersSourceError(costType);
    return q;
  }
  if (type === 14 || type === 15) {
    if (!canChangePioneers(g)) return fail();
    if (!tile || !tile.Revealed) return fail();
    let fac, lvl;
    if (type === 14) { lvl = tile.RoadLevel; if (!(lvl > 0)) return fail(); fac = FAC.ROAD; }
    else { if (tile.BuildingId !== FAC.SHRINE) return fail(); fac = FAC.SHRINE; lvl = tile.Level; }
    q.Level = lvl;
    q.Effect = pioneersFacilityEffect(g, tile, fac, lvl);
    q.Refund = pioneersFacilityIngot(g, tile, fac, lvl);
    q.Source = tile.JobId;
    let busy = tile.JobId !== 0;
    if (type === 15) {
      busy = tile.Stock.gt(ZERO) || tile.BurnRemaining > 0 || busy;
      if (!busy) for (const p of tile.Packets) if (p.Amount.gt(ZERO)) { busy = true; break; }
      if (!busy) for (const c of S.Carts) if (c.TargetCell === cell && c.RawLoad.gt(ZERO) && c.Phase >= 1 && c.Phase <= 4) { busy = true; break; }
    }
    q.Status = busy ? 0x134 : resourceStatus(g, q);
    return q;
  }

  // ---- 1..10 (explore, forest, build, facility upgrade) and anything else (-> 900)
  if (!tile) return fail();
  let busy = tile.JobId !== 0;
  let lvl = 0;
  if (type === 6) {
    if (!(tile.Revealed && tile.Terrain === E_TERRAIN.FOREST)) return fail();
    q.StoneCost = pioneersReservationStoneCost(g, 6, jobCount(S, 6));
  } else if (type === 5) {
    if (tile.Revealed) return fail();
    let any = false;
    for (let d = 0; d < 4; d++) { const n = neighbor(S, cell, d); if (n >= 0 && S.Tiles[n].Revealed) any = true; }
    if (!any) return fail(0x24c);
    q.StoneCost = pioneersReservationStoneCost(g, 5, jobCount(S, 5));
  } else {
    if (!tile.Revealed) return fail();
    const up = isFacilityUpgrade(type), fac = getFacilityId(type);
    const row = g.m.tryGet('PioneersFacility', fac);
    if (!row) return fail();
    const cur = fac === FAC.ROAD ? tile.RoadLevel : fac === FAC.MAGIC_CIRCLE ? tile.MagicLevel : tile.BuildingId === fac ? tile.Level : 0;
    if (up ? cur === 0 : !(cur < 1)) return fail();
    if (!up) {
      if (fac === FAC.SHRINE) { if (tile.Terrain !== 0 || tile.BuildingId !== 0 || tile.RoadLevel > 0) return fail(); }
      else if (fac === FAC.EXTRACTOR) { if (tile.Terrain !== 1 || tile.BuildingId !== 0) return fail(); }
      else if (fac === FAC.ROAD) { if (tile.BuildingId !== 0 || (tile.Terrain !== 0 && tile.Terrain !== 3)) return fail(); }
      else if (fac === FAC.MAGIC_CIRCLE && tile.Terrain !== E_TERRAIN.MAGIC) return fail();
    }
    if (fac === FAC.MAGIC_CIRCLE) {            // one magic-circle job per zone
      const z = zonesOf(g);
      for (const j of S.Jobs) if (getFacilityId(j.Action) === FAC.MAGIC_CIRCLE && z[j.Cell] === z[cell]) { busy = true; break; }
    }
    lvl = cur;
    q.MaxLevel = row.MaxLevel ?? 0;
    q.Effect = lvl < 1 ? ZERO : pioneersFacilityEffect(g, tile, fac, lvl);
    q.NextEffect = pioneersFacilityEffect(g, tile, fac, lvl + 1);
    if (!up) q.IngotCost = new BigNumber(row.BuildIngot ?? 0);
    else {
      q.IngotCost = new BigNumber(row.UpgradeIngot ?? 0).add(new BigNumber(row.UpgradeIngotStep ?? 0).mul(lvl - 1));
      q.StoneCost = ceiling(parseBN(row.UpgradeStone).mul(new BigNumber(row.UpgradeCostUp ?? 0).pow(lvl - 1)));
    }
  }
  q.Level = lvl;
  q.Seconds = pioneersJobSeconds(g, type, tile, jobCount(S, type), lvl);
  if (tile.JobId !== 0) {                      // quote of a tile that already has this job: report what was paid
    for (const j of S.Jobs) if (j.Id === tile.JobId && j.Action === type) { q.IngotCost = j.IngotPaid; q.StoneCost = j.ManaStonePaid; q.Seconds = j.DurationSeconds; break; }
  }
  q.Status = statusWithMax(g, q, busy);
  return q;
}

// ======================= conversion =======================
/** g__Cost|2185_0 @3bfc54c: cost of n purchases starting at the closure's base cost: base*n (CostUp==1) else base*(up^n-1)/(up-1) */
function convCost(n, base, up) {
  if (up.toDouble() === 1) return base.mul(n);
  return base.mul(powInteger(up, n).sub(ONE)).div(up.toDouble() - 1);
}
/** GameData.GetPioneersConversionQuote @3bfa174 (count <= 0 => the max affordable count) */
export function getPioneersConversionQuote(g, id, count) {
  const q = getPioneersQuote(g, 13, -1, id);
  const out = newQuote();
  for (const k of Object.keys(q)) if (k !== 'Allowed') out[k] = q[k];
  const bad = (st) => { out.Status = st; return out; };
  if (q.Cost.le(ZERO)) return bad(900);
  const row = g.m.tryGet('PioneersConversion', id);
  if (!row) return bad(900);
  const up = new BigNumber(row.CostUp ?? 0);
  if (!(up.toDouble() >= 1)) return bad(900);
  const lvl = q.Level;
  const maxRem = 0x7fffffff - lvl;
  if (maxRem < 1) return bad(0x386);
  const budget = pioneersSource(g, row.CostType ?? 0);
  const cost = (n) => convCost(n, q.Cost, up);
  let n = count;
  if (n <= 0) {
    let lo = 0, hi, c = 1;
    for (;;) {
      if (cost(c).le(budget)) {
        const nx = Math.min(maxRem, c * 2);
        lo = c;
        if (maxRem > nx) { c = nx; continue; }
        hi = nx; break;
      }
      hi = c; break;
    }
    while (lo < hi) {
      const mid = lo + ((hi - lo + 1) >> 1);
      if (cost(mid).le(budget)) lo = mid; else hi = mid - 1;
    }
    n = Math.max(1, lo);
  }
  const cnt = Math.min(n, maxRem);
  out.Cost = cost(cnt);
  out.Refund = new BigNumber(row.Ingot ?? 0).mul(cnt);   // ingots gained (quote +0x50)
  out.IngotGain = out.Refund;
  out.Count = cnt;
  out.Source = row.CostType ?? 0;
  out.CostType = out.Source;
  out.Status = budget.ge(out.Cost) ? 0 : pioneersSourceError(out.Source);
  return out;
}
/** ConvertPioneers @3bfd838 -> 0 ok, else status */
export function convertPioneers(g, id, count) {
  if (!canChangePioneers(g)) return 900;
  if (count < 1) return 900;
  if (!g.m.tryGet('PioneersConversion', id)) return 900;
  const lvl = getPioneersConversionLevel(g, id);
  if (0x7fffffff - lvl < count) return 0x386;
  const q = getPioneersConversionQuote(g, id, count);
  if (!q.Allowed) return q.Status;
  g.PioneersBusy = true;
  try {
    g.Pioneers.ConversionLevels.set(id, q.Level + count);
    (g.PioneersConversionBonusCache ??= new Map()).clear();
    g.PioneersRoutesDirty = true;                    // +0x1270
    modifyPioneersIngots(g, q.Refund);
    spendPioneersSource(g, q.Source, q.Cost);
    touchPioneers(g, false, false);
  } finally { g.PioneersBusy = false; }
  return 0;
}

// ======================= bonus =======================
/** GetPioneersPoints @3bf838c: Points[type] * 100 */
export function getPioneersPoints(g, type) {
  const S = g.Pioneers;
  const p = S && S.Points.get(type);
  return p ? p.mul(100) : ZERO;
}
/** GetPioneersPointBonus @3bf8710 */
export const getPioneersPointBonus = (g) => (g.Pioneers ? pioneersEffect(g, 931) : ONE);
/** GetPioneersMapBonus @3bf8464: 0.01 * (100*points)^PointExponent(type) * pointBonus */
export function getPioneersMapBonus(g, type) {
  const pts = getPioneersPoints(g, type);
  if (pts.le(ZERO)) return ZERO;
  let exp = 1;
  for (const r of g.m.findAll('PioneersConversion')) if (r.MilestoneType === type) { exp = r.PointExponent ?? 1; break; }
  return pts.pow(exp).mul(getPioneersPointBonus(g)).mul(0.01);
}
/** GetPioneersCommonMilestoneMultiplier @3bf8818: 1 + CommonMilestoneValue * floor(min conversion level / CommonMilestoneInterval) */
export function getPioneersCommonMilestoneMultiplier(g) {
  if (!g.Pioneers || g.PioneersDisabled) return ONE;
  const s = g.m.setting('PioneersSetting');
  const iv = s.CommonMilestoneInterval ?? 0;
  if (iv <= 0) return ONE;
  let min = 0x7fffffff;
  for (const r of g.m.findAll('PioneersConversion')) min = Math.min(min, getPioneersConversionLevel(g, r.Id));
  if (min === 0x7fffffff) return ONE;
  return ONE.add(new BigNumber(s.CommonMilestoneValue ?? 0).mul(Math.trunc(min / iv)));
}
/** GetPioneersConversionMilestoneBonus @3bf8b48 (per conversion; UI) */
export function getPioneersConversionMilestoneBonus(g, id) {
  if (!g.Pioneers || g.PioneersDisabled) return ZERO;
  const row = g.m.tryGet('PioneersConversion', id);
  if (!row || !((row.MilestoneInterval ?? 0) > 0)) return ZERO;
  const n = Math.trunc(getPioneersConversionLevel(g, id) / row.MilestoneInterval);
  return new BigNumber(row.MilestoneValue ?? 0).mul(n).mul(getPioneersCommonMilestoneMultiplier(g));
}
/** GetPioneersConversionBonus @3bf8d04: sum over conversions of that MilestoneType of value*floor(level/interval), times the common multiplier (cached) */
export function getPioneersConversionBonus(g, type) {
  if (!g.Pioneers || g.PioneersDisabled) return ZERO;
  const cache = (g.PioneersConversionBonusCache ??= new Map());
  const c = cache.get(type);
  if (c) return c;
  let sum = ZERO;
  for (const r of g.m.findAll('PioneersConversion')) {
    if (r.MilestoneType !== type || !((r.MilestoneInterval ?? 0) >= 1)) continue;
    sum = sum.add(new BigNumber(r.MilestoneValue ?? 0).mul(Math.trunc(getPioneersConversionLevel(g, r.Id) / r.MilestoneInterval)));
  }
  const v = sum.mul(getPioneersCommonMilestoneMultiplier(g));
  cache.set(type, v);
  return v;
}
/** GetPioneersBonus @3bf90a8: economy multiplier = 1 + MapBonus (mode 10 and enabled), else 1 */
export function getPioneersBonus(g, type) {
  if (g.GameMode !== 10 || g.PioneersDisabled) return ONE;
  return ONE.add(getPioneersMapBonus(g, type));
}
/** GetPioneersOreReward @3c057b0: points per delivered ore: mana ore ManaStonePerOre, else 1 + ConversionBonus(type of that ore) */
export function getPioneersOreReward(g, ore) {
  if (ore === -1) return new BigNumber(g.m.setting('PioneersSetting').ManaStonePerOre ?? 0);
  const row = g.m.tryGet('PioneersConversion', ore);
  if (!row) return ZERO;
  return ONE.add(getPioneersConversionBonus(g, row.MilestoneType ?? 0));
}
/**
 * RefreshPioneersExternalEffects @3bf91f4: `ext` = Map<type, BigNumber> of the main UpgradeStatus (UpgradeStatus.pioneersExternalEffects).
 * No-op while a Progress snapshot exists. Stores into g.PioneersExternalEffects (+0x1288).
 */
export function refreshPioneersExternalEffects(g, ext) {
  const S = g.Pioneers;
  if (S && S.Progress) return;
  const cache = (g.PioneersExternalEffects ??= new Map());
  let changed = false, pointChanged = false;
  for (const t of PIONEERS_EFFECT_TYPES) {
    const e = extGet(ext, t);
    const nv = e !== undefined ? e : effectDefault(t);
    const cur = cache.get(t);
    if (cur !== undefined) {
      if (cur.ne(nv)) { if (t === 931) pointChanged = pointChanged || cur.ne(nv); cache.set(t, nv); changed = true; }
    } else {
      if (t === 931) pointChanged = pointChanged || effectDefault(t).ne(nv);
      cache.set(t, nv); changed = true;
    }
  }
  if (!changed) return;
  g.PioneersWeatherDirty = true;
  if (S) recalculatePioneersTimes(g);
  touchPioneers(g, pointChanged, true);
}

// ======================= jobs =======================
/** RefreshPioneersJobs @3bf4ed0: a job is Active iff no earlier job is in the same queue (explore / forest / build) */
export function refreshPioneersJobs(g) {
  const J = g.Pioneers.Jobs;
  for (let i = 0; i < J.length; i++) {
    let same = false;
    for (let j = 0; j < i && !same; j++) same = isSameJobQueue(J[j].Action, J[i].Action);
    J[i].Active = !same;
  }
}
/** TouchPioneers @3bf7708 (a = bonus-only change, b = structural change; event flush omitted) */
export function touchPioneers(g, a, b) {
  const S = g.Pioneers;
  if (!a || b) { if (!S) throw new TypeError('TouchPioneers: no state'); S.Revision++; }
  if (a) { if (!S) throw new TypeError('TouchPioneers: no state'); S.BonusRevision++; }
  if (b) {
    (g.PioneersConversionBonusCache ??= new Map()).clear();
    procHooks.clearCaches?.(g);
    g.PioneersRoutesDirty = true;                      // +0x1270
    procHooks.refreshPioneersRoutes?.(g);
  }
  g.PioneersChanged = true;                            // +0x122a (FlushPioneersChanged = event dispatch only)
}
export const flushPioneersChanged = (g) => { g.PioneersChanged = false; };

/** RecalculatePioneersTimes @3bf7834: rescale job/burn/cart timers after effects (research, weather, upgrades) changed */
export function recalculatePioneersTimes(g) {
  const S = g.Pioneers;
  if (!S) return;
  const s = g.m.setting('PioneersSetting');
  for (const j of S.Jobs) {
    const ratio = j.DurationSeconds > 0 ? j.RemainingSeconds / j.DurationSeconds : 1;
    const tile = pioneersTile(g, j.Cell);
    const nd = pioneersJobSeconds(g, j.Action, tile, j.Count ?? 0, j.TargetLevel - 1);
    j.DurationSeconds = nd;
    j.RemainingSeconds = nd * Math.max(0, Math.min(1, ratio));
  }
  for (const t of S.Tiles) {
    if (t.BuildingId !== FAC.SHRINE) continue;
    const nb = pioneersSeconds(g, s.BurnSeconds ?? 0, 924);
    const old = t.BurnDuration ?? 0;
    if (old > 0 && t.BurnRemaining > 0) t.BurnRemaining = (nb / old) * t.BurnRemaining;
    t.BurnDuration = nb;
  }
  for (const c of S.Carts) {
    const ph = c.Phase;
    if (ph === 2 || ph === 5) {
      const list = ph === 2 ? c.OutboundPath : c.ReturnPath;
      const idx = c.LegIndex + ((c.LegProgress ?? 0) >= 0.5 ? 1 : 0);
      if (idx < list.length) c.Ground = ground(g, S.Tiles[list[idx]]);
    }
    if (ph === 1 || ph === 4) {
      const nd = pioneersSeconds(g, ph === 1 ? (s.LoadSeconds ?? 0) : (s.UnloadSeconds ?? 0), 923);
      const old = c.PhaseDuration;
      c.PhaseRemaining = old > 0 ? (nd * c.PhaseRemaining) / old : nd;
      c.PhaseDuration = nd;
    }
  }
  procHooks.clearCaches?.(g);
  g.PioneersRoutesDirty = true;
}

/** StartPioneersJob @3bfdabc (types 1..10) -> 0 ok else status. Pays ingots/stones, registers the job, tile.JobId. */
export function startPioneersJob(g, type, cell) {
  if (((type - 16) >>> 0) >= 0xfffffffb) return 900;       // types 11..15 are not jobs
  if (!canChangePioneers(g)) return 900;
  const q = getPioneersQuote(g, type, cell, 0);
  if (!q.Allowed) return q.Status;
  const S = g.Pioneers;
  const tile = pioneersTile(g, cell);
  g.PioneersBusy = true;
  try {
    const n = jobCount(S, type);
    const job = { Id: S.Format++, Cell: cell, Action: type, Count: n, TargetLevel: q.Level + 1, IngotPaid: q.IngotCost, ManaStonePaid: q.StoneCost,
      DurationSeconds: q.Seconds, RemainingSeconds: q.Seconds, Active: false };
    S.X70.set(type, n + 1);
    S.Jobs.push(job);
    tile.JobId = job.Id;
    modifyPioneersIngots(g, q.IngotCost.neg());
    modifyPioneersManaStone(g, q.StoneCost.neg());
    refreshPioneersJobs(g);
    touchPioneers(g, false, false);
  } finally { g.PioneersBusy = false; }
  return 0;
}
/** ReleasePioneersReservation @3bfe044: a cancelled job frees its slot: later jobs of that type shift down; explore/forest jobs get the cheaper stone price refunded */
export function releasePioneersReservation(g, job) {
  const S = g.Pioneers;
  const a = job.Action;
  const n = jobCount(S, a) - 1;
  if (n >= 0) S.X70.set(a, n);
  for (const j of S.Jobs) {
    if (j.Action !== a || !(j.Count > job.Count)) continue;
    j.Count--;
    if (a === 5 || a === 6) {
      const nc = pioneersReservationStoneCost(g, a, j.Count);
      if (nc.lt(j.ManaStonePaid)) { modifyPioneersManaStone(g, j.ManaStonePaid.sub(nc)); j.ManaStonePaid = nc; }
    }
  }
}
/** CancelPioneersJob @3bfdde4 -> 0 ok, 900 not found / not allowed. Refunds everything paid. */
export function cancelPioneersJob(g, jobId) {
  if (!canChangePioneers(g)) return 900;
  const S = g.Pioneers;
  const i = S.Jobs.findIndex((j) => j.Id === jobId);
  if (i < 0) return 900;
  const job = S.Jobs[i];
  g.PioneersBusy = true;
  try {
    S.Jobs.splice(i, 1);
    pioneersTile(g, job.Cell).JobId = 0;
    modifyPioneersIngots(g, job.IngotPaid);
    modifyPioneersManaStone(g, job.ManaStonePaid);
    releasePioneersReservation(g, job);
    refreshPioneersJobs(g);
    recalculatePioneersTimes(g);
    touchPioneers(g, false, false);
  } finally { g.PioneersBusy = false; }
  return 0;
}
/** GetPioneersCancelManaStone @3bfe324: stones that cancelling `job` would additionally refund through the reservation shift */
export function getPioneersCancelManaStone(g, job) {
  let sum = ZERO;
  if (!job || !g.Pioneers) return sum;
  if (job.Action !== 5 && job.Action !== 6) return sum;
  for (const j of g.Pioneers.Jobs) {
    if (j.Action !== job.Action || !(j.Count > job.Count)) continue;
    const nc = pioneersReservationStoneCost(g, j.Action, j.Count - 1);
    if (nc.lt(j.ManaStonePaid)) sum = sum.add(j.ManaStonePaid.sub(nc));
  }
  return sum;
}
/** CompletePioneersJobs @3c05a1c: finish every Active job whose RemainingSeconds <= 1e-7 (iterating from the last job) */
export function completePioneersJobs(g) {
  const S = g.Pioneers;
  let done = false;
  for (let i = S.Jobs.length - 1; i >= 0; i--) {
    const job = S.Jobs[i];
    if (!(job.Active && job.RemainingSeconds <= 1e-7)) continue;
    const tile = S.Tiles[job.Cell];
    const a = job.Action;
    if (a === 5) tile.Revealed = true;
    else if (a === 6) tile.Terrain = E_TERRAIN.GRASS;
    else {
      const fac = getFacilityId(a);
      if (fac === FAC.ROAD) tile.RoadLevel = job.TargetLevel;                  // roads / magic circles do NOT set BuildingId/Level
      else if (fac === FAC.MAGIC_CIRCLE) {                                      // MagicLevel is zone-wide
        const z = zonesOf(g), zc = z[tile.Cell];
        for (const t of S.Tiles) if (z[t.Cell] === zc) t.MagicLevel = job.TargetLevel;
      } else { tile.BuildingId = fac; tile.Level = job.TargetLevel; S.Act = S.Shr = S.Ext = null; g.PioneersCandDirty = true; }
    }
    tile.JobId = 0;
    S.Jobs.splice(i, 1);
    if (S.Progress && typeof S.Progress.JobCount === 'number') S.Progress.JobCount--;   // PioneersProgressData+0x40
    done = true;
  }
  if (done) {
    refreshPioneersJobs(g);
    recalculatePioneersTimes(g);
    procHooks.synchronizePioneersCarts?.(g);
    touchPioneers(g, false, true);
  }
}

/** UpgradePioneers @3bfeb00 (tile upgrade, instant; magic-land tiles apply to the whole zone) -> 0 ok else status */
export function upgradePioneers(g, cell, id) {
  if (!canChangePioneers(g)) return 900;
  const q = getPioneersQuote(g, 11, cell, id);
  if (!q.Allowed) return q.Status;
  const S = g.Pioneers;
  g.PioneersBusy = true;
  try {
    const tile = S.Tiles[cell];
    if (tile.Terrain === E_TERRAIN.MAGIC) {
      const z = zonesOf(g);
      for (const t of S.Tiles) if (z[t.Cell] === z[cell]) t.UpgradeLevels.set(id, q.Level + 1);
    } else tile.UpgradeLevels.set(id, q.Level + 1);
    modifyPioneersIngots(g, q.IngotCost.neg());
    modifyPioneersManaStone(g, q.StoneCost.neg());
    recalculatePioneersTimes(g);
    procHooks.synchronizePioneersCarts?.(g);
    touchPioneers(g, false, true);
  } finally { g.PioneersBusy = false; }
  return 0;
}
/** ResearchPioneers @3bff3b0 -> 0 ok else status. Costs stones + mana (balance 153). */
export function researchPioneers(g, id) {
  if (!canChangePioneers(g)) return 900;
  const q = getPioneersQuote(g, 12, -1, id);
  if (!q.Allowed) return q.Status;
  g.PioneersBusy = true;
  try {
    g.Pioneers.ResearchLevels.set(id, q.Level + 1);
    g.PioneersWeatherDirty = true;                    // +0x12a0: effects status must be rebuilt
    modifyPioneersManaStone(g, q.StoneCost.neg());
    g.modifyBalance(153, q.ManaCost.neg());
    recalculatePioneersTimes(g);
    touchPioneers(g, true, true);
  } finally { g.PioneersBusy = false; }
  return 0;
}
/** DemolishPioneers @3bfe5d4 (type 14 road / 15 shrine) -> 0 ok else status */
export function demolishPioneers(g, type, cell) {
  if (!canChangePioneers(g) || (type !== 14 && type !== 15)) return 900;
  const q = getPioneersQuote(g, type, cell, 0);
  if (!q.Allowed) return q.Status;
  const tile = g.Pioneers.Tiles[cell];
  g.PioneersBusy = true;
  try {
    if (type === 14) { tile.RoadLevel = 0; procHooks.refreshPioneersDockedCartGround?.(g); }
    else {
      tile.BuildingId = 0; tile.Level = 0; g.Pioneers.Act = g.Pioneers.Shr = g.Pioneers.Ext = null; g.PioneersCandDirty = true;
      tile.UpgradeLevels.clear();
      tile.Stock = ZERO;
      tile.Packets.length = 0;
      tile.BurnRemaining = 0; tile.BurnDuration = 0;
      tile.LastBurnRewards.length = 0;
      tile.LastBurnSequence = 0;
      tile.LastBurnAmount = ZERO;
    }
    modifyPioneersIngots(g, q.Refund);
    recalculatePioneersTimes(g);
    touchPioneers(g, false, true);
  } finally { g.PioneersBusy = false; }
  return 0;
}

// wire the hooks pioneers_map.js expects
hooks.touchPioneers = touchPioneers;
hooks.recalculatePioneersTimes = recalculatePioneersTimes;
hooks.facilityValue = facilityValue;
