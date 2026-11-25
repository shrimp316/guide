// Master data access (Root::TryGet*, M::*, Master* rows). Engine code is environment-neutral:
//   new Master({sheets, enums, text}, provider?)   provider(name) -> rows|object|undefined  (lazy extra sheets)
// Node adapter: ./node_loader.js. Rows are the raw JSON objects (field names == C# Master* property names,
// vectors are arrays, BigNumber fields are strings -> use m.bn(row, 'Hp')).
// Missing optional fields read as undefined (FlatBuffers default = 0 / "" / empty vector).
import { BigNumber } from './bignum.js';

// primary key per table (what Root.TryGetX indexes by)
const KEYS = {
  Field: 'Level', SoulAltar: 'Level', Rank: 'Rank', NewWorldRank: 'Rank', CardLevel: 'Level', UltimateCardLevel: 'Level',
  Membership: 'Id', MembershipStat: 'Id', Product: 'ProductId', Reward: 'RewardId', Parameter: 'Key',
};
const keyOf = (name) => KEYS[name] ?? 'Id';

export class Master {
  constructor({ sheets = {}, enums = {}, text = {} } = {}, provider = null) {
    this.sheets = sheets; this.enums = enums; this.text = text; this.provider = provider;
    this._idx = new Map();
  }

  /** raw sheet: array of rows, or one object for *Setting singletons. Throws if unknown. */
  sheet(name) {
    let s = this.sheets[name];
    if (s === undefined && this.provider) { s = this.provider(name); if (s !== undefined) this.sheets[name] = s; }
    if (s === undefined) throw new Error(`master sheet not available: ${name}`);
    return s;
  }
  addSheet(name, data) { this.sheets[name] = data; this._idx.delete(name); }

  /** FindAll*: all rows of a table. */
  findAll(name) { return this.sheet(name); }
  /** settings singleton (NewWorldSetting, ScienceSetting, ...). */
  setting(name) { return this.sheet(name); }

  /** indexed lookup by the table's primary key (Id / Level / Rank). null if absent. */
  tryGet(name, key) {
    let idx = this._idx.get(name);
    if (!idx) {
      idx = new Map(); const k = keyOf(name);
      for (const r of this.sheet(name)) idx.set(r[k], r);
      this._idx.set(name, idx);
    }
    return idx.get(key) ?? null;
  }
  /** Get*(id) that the game treats as always-present: throws when missing. */
  get(name, key) {
    const r = this.tryGet(name, key);
    if (!r) throw new Error(`${name}[${key}] not found`);
    return r;
  }

  /** BigNumber field (string -> BN via C.ParseBigNumberCached @4138a50; missing/invalid -> Zero). */
  bn(row, field) { return BigNumber.parse(row?.[field]); }

  // ---- Root.TryGet* (@3a2b200 etc.) ----
  tryGetUpgrade(id) { return this.tryGet('Upgrade', id); }
  tryGetField(level) { return this.tryGet('Field', level); }
  tryGetBlock(id) { return this.tryGet('Block', id); }
  tryGetWeapon(id) { return this.tryGet('Weapon', id); }
  tryGetNewWorld(id) { return this.tryGet('NewWorld', id); }
  tryGetSoulAltar(level) { return this.tryGet('SoulAltar', level); }
  tryGetRank(rank) { return this.tryGet('Rank', rank); }
  tryGetNewWorldRank(rank) { return this.tryGet('NewWorldRank', rank); }
  tryGetCard(id) { return this.tryGet('Card', id); }
  /** Root.TryGetText @3d91490 -> Korean text (MasterText.Ko) or null */
  tryGetText(key) { return this.text[key] ?? null; }

  // ---- M.* ----
  /** M.GetFieldMax / GetNewWorldRankMax (decompile STUB; derived from data). */
  get fieldMax() { return this._fieldMax ??= Math.max(...this.sheet('Field').map((r) => r.Level)); }
  get newWorldRankMax() { return this._nwRankMax ??= Math.max(...this.sheet('NewWorldRank').map((r) => r.Rank)); }

  /** M.GetFieldPrice @3a503f0: mode 10 (NewWorld) -> NewWorldPrice else Price (BigNumber). */
  getFieldPrice(field, mode) { return this.bn(field, mode === 10 ? 'NewWorldPrice' : 'Price'); }

  /** M.TryGetBlockByField @3a50154: Field[level].Block -> Block row (or null). */
  tryGetBlockByField(level) {
    const f = this.tryGetField(level);
    return f ? this.tryGetBlock(f.Block) : null;
  }
  /**
   * M.TryGetNewWorldBlockByField @3a50ee0 (+TryGetNewWorldBlockTier @3a50f70, not decompiled).
   * Data: NewWorld blocks are Block rows br_new_world_<n> (Id 2900+n, Field n, Hp/Reward only).
   */
  tryGetNewWorldBlockByField(level) {
    if (!this._nwBlocks) {
      this._nwBlocks = new Map();
      for (const b of this.sheet('Block')) if (typeof b.Name === 'string' && b.Name.startsWith('br_new_world_')) this._nwBlocks.set(b.Field, b);
    }
    return this._nwBlocks.get(level) ?? null;
  }

  /** M.SafeGetBlockChanceWeights @3a52878 / SafeGetHighBlockChanceWeights @3a52a18 (0 if out of range). */
  safeGetBlockChanceWeights(i) { return safe(this.setting('GameSetting').BlockChanceWeights, i); }
  safeGetHighBlockChanceWeights(i) { return safe(this.setting('GameSetting').HighBlockChanceWeights, i); }

  /** M.GetTypeCount @3a50424 (row = Card-like row with TypeList/NewWorldTypeList; mode 10 = NewWorld). */
  getTypeCount(row, mode) {
    if (!row) return 0;
    const rowMode = row.Mode ?? 0;
    if (mode !== 10 && rowMode === 10) return 0;
    if (mode === 10) {
      if (rowMode !== 10 && (row.Grade ?? 0) !== 90) return 0;
      const n = row.NewWorldTypeList?.length ?? 0;
      if (n > 0) return n;
    }
    return row.TypeList?.length ?? 0;
  }

  /**
   * M.GetValue @3a5060c: value of effect #i of a Card-like row at `level` (1-based), as double.
   * ValueUpType: 1 add (base+mul*l), 2 percent (base*(1+mul/100)^l), 4 divide (base/mul^l), else base*mul^l; then + add*l.
   */
  getValue(row, i, level, mode) {
    if (i < 0 || level < 1 || this.getTypeCount(row, mode) <= i) return 0;
    const l = level - 1;
    let base, mul, add, type;
    if (mode === 10 && (row.NewWorldTypeList?.length ?? 0) > 0) {
      base = safe(row.NewWorldValueList, i); mul = safe(row.NewWorldValueUpMulList, i);
      add = safe(row.NewWorldValueUpAddList, i); type = row.NewWorldValueUpType ?? 0;
    } else {
      base = safe(row.ValueList, i); mul = safe(row.ValueUpMulList, i);
      add = safe(row.ValueUpAddList, i); type = row.ValueUpType ?? 0;
    }
    let v;
    if (type === 4) v = base / Math.pow(mul, l);
    else if (type === 1) v = base + mul * l;
    else { if (type === 2) mul = mul * 0.01 + 1; v = base * Math.pow(mul, l); }
    return add * l + v;
  }
}

const safe = (arr, i) => (i >= 0 && arr && i < arr.length ? arr[i] : 0);

/** M.TryGetArcLink @3a50324: arc link index (0..16) -> [upgradeId, nodeId] | null. (pure arithmetic from the binary) */
export function tryGetArcLink(i) {
  if (!(i >= 0 && i < 0x11)) return null;
  let a = i + 0x17ae1, b = i + 0x17ae4;
  if (i < 8) { const t = ((i & 1) | 97000) + (i & ~1) + (i >> 1); a = t + 1; b = t + 2; }
  return [a, b];
}
/** M.TryGetArcCircuit @3a50384: circuit id (0x182b9..+5) -> [baseId, bitmask] | null. */
export function tryGetArcCircuit(id) {
  const u = id - 0x182b9;
  if (!(u >= 0 && u < 6)) return null;
  const t = (u & ~1) + (u >> 1) + (u & 1);
  return [t + 0x17ae9, (0x300 << (t & 31)) | (1 << ((id + 9) & 0xf)) | (1 << (u & 31))];
}
/** C.GetDataIdType @4134458 */
export const getDataIdType = (id) => Math.trunc(id / 1000);
/** C.GetCardCraftFrameCount @4135468 (arg = card Grade) */
export const getCardCraftFrameCount = (g) => (g >= 1 && g <= 4 ? g : g === 5 || g === 6 || g === 90 ? 5 : 0);
/** Node.GetFactor @3cb09ac. node = {flag (byte+0x20), count (int+0x24), factor (double+0x30), divisor (double+0x38)} */
export function nodeGetFactor(n, level) {
  if (n.flag || n.count <= level) return n.factor;
  const d = n.divisor <= 0 ? 1 : n.divisor;
  return ((n.factor - 1) / d * level) / n.count + 1;
}
