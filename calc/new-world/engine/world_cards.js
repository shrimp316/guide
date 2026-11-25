// U4 cards: NewWorld card collection / crafting (frames -> copies) / level-up (world crystal). Ported from disassembly
// (decompile of these GameData methods is mangled): GetCardData @3b9cba4, IsNewWorldCardUnlocked @3b9cc2c,
// IsCardCraftAvailable @3b9cfb8, GetCardCraftCountToNextLevel @3b9d234, SetCardData @3b9d88c, AddCard @3b9de84,
// CraftCard(toNext) @3b9e378 (= CraftCardToNextLevel @3b9e7ac), LevelUpCard @3b9e7b8, ModifyWorldCrystal @3b9ee50.
// Conventions as game_state.js: fn(m, g, status?, ...), C# int error codes (0 ok).
//
// State added to g:
//   g.cards   Map<id, {Id, Level, Count}>   +0x460 Dictionary<int,CardData>  (CardData = {int Id@0, int Level@4, int Count@8})
//   g.mode    +0x410 card mode (10 = NewWorld)
//   g.frames  {155,156,157,158}             +0x608 / +0x610 / +0x618 (0x9b normal, 0x9c hero, 0x9d legend); 0x9e golden = 0 (no field)
//   g.worldCrystal                          +0x600 (Number)
import { getCardFrameType, getCardLevelUpCount, getCardLevelUpCost } from './expr_y.js';
import { getCardCraftFrameCount } from './master.js';

export function initCardState(g) {
  g.cards ??= new Map();
  g.mode ??= 10;
  g.frames ??= { 155: 0, 156: 0, 157: 0, 158: 0 };
  g.worldCrystal ??= 0;
  return g;
}

const I32_MAX = 0x7fffffff;
const maxCache = new WeakMap();
/** M.CardLevelMax (M+0x78, @3a47244 getter): assumed = max Level of the CardLevel sheet (10). See U1 notes. */
export function cardLevelMax(m) {
  let v = maxCache.get(m);
  if (v === undefined) maxCache.set(m, v = Math.max(...m.sheet('CardLevel').map((r) => r.Level)));
  return v;
}

/** GetCardData @3b9cba4: missing -> {id, level 0, count 0}. */
export function getCardData(g, id) {
  return g.cards.get(id) ?? { Id: id, Level: 0, Count: 0 };
}
/** SetCardData @3b9d88c (dictionary set, always 0). */
export function setCardData(g, id, level, count = 0) {
  g.cards.set(id, { Id: id, Level: level, Count: count });
  return 0;
}
const isHave = (cd) => cd.Level > 0; // CardData.get_IsHave @3c43d7c
const card = (m, id) => m.tryGetCard(id);

/**
 * AddCard @3b9de84: n<=0 -> 0x384; unknown card 0x68. (TryReplaceMaxLevelGoldenCard @3b9d900 -- golden card at max level
 * -> converted into a reward -- is NOT ported; the sim never adds golden cards.) New level = max(level,1) unless grade 7
 * (stays); count += n. Grade-6 side effect (SetState) and mission hooks ignored.
 */
export function addCard(m, g, id, n) {
  if (n <= 0) return 0x384;
  const c = card(m, id);
  if (!c) return 0x68;
  const cd = getCardData(g, id);
  const level = c.Grade === 7 ? cd.Level : Math.max(cd.Level, 1);
  g.cards.set(id, { Id: id, Level: level, Count: cd.Count + n });
  return 0;
}

/** IsNewWorldCardUnlocked @3b9cc2c (gd.mode==10 path; other modes return as the game: only the 10 path is ported). */
export function isNewWorldCardUnlocked(m, g, id) {
  const c = card(m, id);
  if (!c) return false;
  const grade = c.Grade ?? 0, mode = c.Mode ?? 0;
  if (getCardFrameType(g.mode, grade) === 0) return false;
  if (grade === 90 ? !(mode === 0 || mode === 1 || mode === 10) : mode !== 10) return false;
  if (!c.IsUltimate) return true;
  const max = cardLevelMax(m);
  for (const o of m.findAll('Card')) { // static list order; same Grade, Mode 10, non-ultimate cards must all be at max level
    if ((o.Grade ?? 0) !== grade || (o.Mode ?? 0) !== 10 || o.IsUltimate) continue;
    if (getCardData(g, o.Id).Level < max) return false;
  }
  return true;
}

/** IsCardCraftAvailable @3b9cfb8. */
export function isCardCraftAvailable(m, g, id) {
  const c = card(m, id);
  if (!c) return false;
  const grade = c.Grade ?? 0;
  if (getCardFrameType(g.mode, grade) === 0) return false;
  if (g.mode === 1) { if (!((c.Mode ?? 0) === 0 || c.Mode === 1)) return false; }
  else if (g.mode === 10) { if (!isNewWorldCardUnlocked(m, g, id)) return false; }
  else return false;
  const cd = getCardData(g, id);
  if (cd.Level > 0x7ffffffe || cd.Count < 0 || cd.Count === I32_MAX) return false;
  if (!c.IsUltimate && cardLevelMax(m) <= cd.Level) return false;
  const N = getCardLevelUpCount(m, g.mode, !!c.IsUltimate, grade, cd.Level);
  if (N < 1) return false;
  return !isHave(cd) ? true : cd.Count < N;
}

/** GetCardCraftCountToNextLevel @3b9d234: copies still needed (not craftable 0; not owned 1). */
export function getCardCraftCountToNextLevel(m, g, id) {
  if (!isCardCraftAvailable(m, g, id)) return 0;
  const cd = getCardData(g, id);
  if (!isHave(cd)) return 1;
  const c = card(m, id);
  return getCardLevelUpCount(m, g.mode, !!c.IsUltimate, c.Grade ?? 0, cd.Level) - cd.Count;
}

/** Frame balance (GetFrameBalance @416ec74 on the sim side; fields +0x608/+0x610/+0x618). */
export const getFrameBalance = (g, type) => g.frames[type] ?? 0;
export function addCardFrame(g, type, n) { g.frames[type] = (g.frames[type] ?? 0) + n; }

/** CraftCardToNextLevel @3b9e7ac -> CraftCard @3b9e378. Costs getCardCraftFrameCount(grade)*n frames of the card's frame type. */
export function craftCardToNextLevel(m, g, id) {
  const c = card(m, id);
  if (!c) return 0x68;
  if (g.mode === 10 && !isNewWorldCardUnlocked(m, g, id)) return 0x12f;
  const cd = getCardData(g, id);
  if (cd.Level < 0 || cd.Level === I32_MAX || cd.Count < 0 || cd.Count === I32_MAX) return 1000;
  if (!isCardCraftAvailable(m, g, id)) return 0x385;
  const n = getCardCraftCountToNextLevel(m, g, id);
  if (n < 1 || I32_MAX - cd.Count < n) return 1000;
  const grade = c.Grade ?? 0, type = getCardFrameType(g.mode, grade), cost = getCardCraftFrameCount(grade) * n;
  if ((g.frames[type] ?? 0) < cost) return 0x17; // IsCostEnough error code not decoded (assumed 0x17 like crystal)
  g.frames[type] -= cost;
  return addCard(m, g, id, n);
}

/**
 * LevelUpCard @3b9e7b8 (mode 10): 0x68 missing / grade 7 -> 0x385 / golden 0x2328 / locked 0x12f / bad data 0x3e8 /
 * count<N 0x190 / crystal<cost 0x17. Effect: crystal -= cost, level+1, count -= N. (mode != 10 spell-book path not ported.)
 */
export function levelUpCard(m, g, id) {
  const c = card(m, id);
  if (!c) return 0x68;
  const grade = c.Grade ?? 0;
  if (grade === 7) return 0x385;
  if (g.mode === 10) {
    if (grade === 90) return 0x2328;
    if (!isNewWorldCardUnlocked(m, g, id)) return 0x12f;
  }
  const cd = getCardData(g, id);
  if (cd.Level > 0x7ffffffe || cd.Count < 0) return 0x3e8;
  if (!isHave(cd)) return 0x12f;
  if (!c.IsUltimate && cd.Level >= cardLevelMax(m)) return 0x385;
  const ult = !!c.IsUltimate;
  const N = getCardLevelUpCount(m, g.mode, ult, grade, cd.Level);
  const cost = getCardLevelUpCost(m, g.mode, ult, grade, cd.Level);
  if (N < 1 || cost < 0) return 0x3e8; // (GetCardLevelUpPrismCard<0 also -> 0x3e8; prism is unused in mode 10)
  if (cd.Count < N) return 0x190;
  if (g.mode !== 10) throw new Error('levelUpCard: spell-book path (mode != 10) not ported');
  if (g.worldCrystal < cost) return 0x17;
  g.worldCrystal -= cost;
  g.cards.set(id, { Id: id, Level: cd.Level + 1, Count: cd.Count - N });
  return 0;
}

/** Sim Setup (SIM_SPEC 5.1): golden cards (Grade 90, GameId==themeId) get a level; levels = number | {id: level}; level<=0 skips. */
export function setupGoldenCards(m, g, themeId, levels) {
  for (const c of m.findAll('Card')) {
    if (c.Grade !== 90 || c.GameId !== themeId) continue;
    const lv = typeof levels === 'number' ? levels : (levels?.[c.Id] ?? 0);
    if (lv > 0) setCardData(g, c.Id, lv, 0);
  }
}
