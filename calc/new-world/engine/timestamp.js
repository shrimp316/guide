// Timestamp (@4344258..4345a2c). Game type = int64 FILETIME ticks (100ns since 1601-01-01 UTC); 0 = invalid.
// JS port: Number of MILLISECONDS since 1601 (exact in a double; every game-side Add*/Interval rounds to whole ms).
// Differences (op_Subtraction) are plain ms Numbers (TimeSpan); use totalHours/totalDays/totalSeconds.

export const INVALID = 0;                               // default(Timestamp)
const EPOCH_1601_TO_1970_MS = 11644473600000;
const KST_MS = 9 * 3600 * 1000;                         // KST offset (UTC+9), NewWorldBalanceSimulation statics+0xb0

export const isValid = (t) => t > 0;                    // get_IsValid @43443b8 (value > 0)
export const lt = (a, b) => a < b;                      // @43444ec
export const le = (a, b) => a <= b;                     // @43450b0
export const gt = (a, b) => a > b;                      // @4345224
export const ge = (a, b) => a >= b;                     // @4344420
export const sub = (a, b) => a - b;                     // op_Subtraction(Timestamp,Timestamp) @43446a0 -> TimeSpan(ms)
export const min = (a, b) => (a < b ? a : b);           // sim Min @416666c

// TimeSpan.FromX(double) = Interval(value, scale): (long)(value*scale + (value>=0 ? .5 : -.5)) ms  (@6fb1630)
const interval = (v, scale) => Math.trunc(v * scale + (v >= 0 ? 0.5 : -0.5));
export const addSeconds = (t, s) => t + interval(s, 1000);          // @43448d4
export const addMinutes = (t, m) => t + interval(m, 60000);         // @4344958
export const addHours = (t, h) => t + interval(h, 3600000);         // @43449e4
export const addDays = (t, d) => t + interval(d, 86400000);         // @4344a70

export const totalSeconds = (ms) => ms / 1000;
export const totalHours = (ms) => ms / 3600000;
export const totalDays = (ms) => ms / 86400000;

export const fromUnixMs = (ms) => ms + EPOCH_1601_TO_1970_MS;
export const toUnixMs = (t) => t - EPOCH_1601_TO_1970_MS;

/** sim FromKst @4165398: wall-clock KST (y, mo 1-12, d, h, mi, s) -> Timestamp. */
export const fromKst = (y, mo, d, h = 0, mi = 0, s = 0) => fromUnixMs(Date.UTC(y, mo - 1, d, h, mi, s) - KST_MS);

/** sim ToKst @4168980: Timestamp -> {y, mo, d, h, mi, s, dow, dayNumber}. dayNumber = days since 1970 of the KST calendar date. */
export function toKst(t) {
  const ms = toUnixMs(t) + KST_MS;
  const dt = new Date(ms);
  return {
    y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(), dow: dt.getUTCDay(),
    dayNumber: Math.floor(ms / 86400000),
  };
}
/** (ToKst(a).Date - ToKst(b).Date).TotalDays as used for _dayIndex. */
export const kstDayDiff = (a, b) => toKst(a).dayNumber - toKst(b).dayNumber;
