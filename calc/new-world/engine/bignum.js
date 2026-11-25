// BigNumber port (Brick Inc, il2cpp BigNumber @42d42c0..42d5cc8).
// Layout: value = m * 1000^e, e is an int32 in units of 3 decimal digits (NOT 10^e).
// Instances are immutable; every op returns a new BigNumber. Mirrors the decompiled
// arithmetic bit-for-bit (same fp operations in the same order).
// Where the C# has (BN,double)/(double,BN) overloads, pass a JS number as the operand.

// BigNumber.<static double[16]> @cctor 42d5cc8: T[i] = 1000^i (i<16). Beyond that operands are ignored/saturated.
const T = Array.from({ length: 16 }, (_, i) => 1000 ** i);
const MAXD = 1.7976931348623157e308;
const LN10 = 2.302585092994046; // 15e5510

const num = (x) => (x instanceof BigNumber ? x : new BigNumber(x));

export class BigNumber {
  /** ctor(double m, int e=0) @42d4430 / @42d42d0: zero for 0/NaN/Inf, then Normalize @42d4370. */
  constructor(m = 0, e = 0) {
    if (m === 0 || !Number.isFinite(m)) { this.m = 0; this.e = 0; return; }
    e |= 0;
    let a = Math.abs(m);
    if (a < 0.01) {
      do { a *= 1000; m *= 1000; e--; } while (a < 0.01);
    }
    if (a < 1) {
      // quirk: exponent never drops to -1 through this loop (so 0.5 stays {0.5,0})
      for (;;) {
        const c = e - 1;
        if (c === -1) break;
        a *= 1000; m *= 1000; e = c;
        if (!(a < 1)) break;
      }
    }
    if (a >= 1000) {
      do { a /= 1000; e++; m /= 1000; } while (a >= 1000);
    }
    this.m = m; this.e = e;
  }

  static of(x) { return num(x); }
  static get ZERO() { return ZERO; }
  static get ONE() { return ONE; }

  get isZero() { return this.m === 0; }

  // ---- arithmetic -------------------------------------------------------
  /** op_Addition @42d4bf4 */
  add(b) {
    b = num(b);
    if (this.m === 0) return b;
    if (b.m === 0) return this;
    const d = this.e - b.e;
    let m, e;
    if (d === 0) { m = this.m + b.m; e = this.e; }
    else if (d < 0) {
      const n = -d;
      m = n < 16 ? this.m / T[n] + b.m : b.m;
      e = b.e;
    } else {
      m = d < 16 ? this.m + b.m / T[d] : this.m;
      e = this.e;
    }
    return new BigNumber(m, e);
  }

  /** op_Subtraction @42d4950 */
  sub(b) {
    b = num(b);
    if (this.m === 0) return new BigNumber(-b.m, b.e);
    if (b.m === 0) return this;
    const d = this.e - b.e;
    let m, e;
    if (d === 0) { m = this.m - b.m; e = b.e; }
    else if (d < 0) {
      const n = -d;
      m = n < 16 ? this.m / T[n] - b.m : -b.m;
      e = b.e;
    } else {
      m = d < 16 ? this.m - b.m / T[d] : this.m;
      e = this.e;
    }
    return new BigNumber(m, e);
  }

  /** op_Multiply(BN,BN) @42d511c; op_Multiply(BN,double) @42d4b34 */
  mul(b) {
    if (typeof b === 'number') return new BigNumber(this.m * b, this.e);
    return new BigNumber(this.m * b.m, this.e + b.e);
  }

  /** op_Division(BN,BN) @42d4e44; op_Division(BN,double) @42d5970 */
  div(b) {
    if (typeof b === 'number') return new BigNumber(this.m / b, this.e);
    return new BigNumber(this.m / b.m, this.e - b.e);
  }

  /** op_Division(double,BN) @42d599c  (= d / this) */
  rdiv(d) { return new BigNumber(d / this.m, -this.e); }

  /** op_UnaryNegation @42d56e8 */
  neg() { return new BigNumber(-this.m, this.e); }

  /** Reciprocal @42d4dbc: ctor(1.0/m, -e) with One.m/One.e from statics (== 1/m, -e). */
  reciprocal() { return new BigNumber(1 / this.m, -this.e); }

  // ---- comparison -------------------------------------------------------
  /** CompareTo @42d5330 -> -1/0/1 */
  cmp(b) {
    b = num(b);
    let am = this.m, bm = b.m;
    if (am === 0 && bm === 0) return 0;
    if (bm <= 0 && am > 0) return 1;
    if (bm >= 0 && am < 0) return -1;
    const d = this.e - b.e;
    if (d >= 1) {
      am = d >= 16 ? (am <= 0 ? -MAXD : MAXD) : am * T[d];
    } else if (d < 0) {
      const n = -d;
      bm = n >= 16 ? (bm <= 0 ? -MAXD : MAXD) : T[n] * bm;
    }
    return am <= bm ? (am < bm ? -1 : 0) : 1;
  }
  lt(b) { return this.cmp(b) < 0; }          // @42d59cc
  le(b) { return this.cmp(b) < 1; }          // @42d5a48
  gt(b) { return this.cmp(b) > 0; }          // @42d5ac8
  ge(b) { return this.cmp(b) >= 0; }         // @42d5b48
  eq(b) { return this.cmp(b) === 0; }        // @42d5bc8
  ne(b) { return this.cmp(b) !== 0; }        // @42d5c48

  // ---- conversion -------------------------------------------------------
  /** ToDouble @42d44d4: m * Math.Pow(1000, e) (Infinity for e*3 > 308) */
  toDouble() {
    return this.e !== 0 && this.m !== 0 ? this.m * Math.pow(1000, this.e) : this.m;
  }
  /** ToFloat @42d455c */
  toFloat() { return Math.fround(this.toDouble()); }
  /** ToInt @42d45b8: round-half-even of ToDouble, saturating cast (Infinity -> int.MinValue) */
  toInt() { return castSat(roundEven(this.toDouble()), -2147483648, 2147483647); }
  /** ToLong @42d46c0 (returns a JS Number: exact only below 2^53) */
  toLong() { return castSat(roundEven(this.toDouble()), -9223372036854775808, 9223372036854775807); }
  /** ToMultiplier @42d4b60: One + this*0.01 (percent -> multiplier) */
  toMultiplier() { return ONE.add(new BigNumber(this.m * 0.01, this.e)); }

  // ---- math -------------------------------------------------------------
  /** Log10 @42d52a0: returns a BigNumber holding log10(value) */
  log10() { return new BigNumber(Math.log10(this.m) + this.e * 3.0); }
  /** Log() @42d5150: natural log as BigNumber */
  ln() { return new BigNumber(Math.log(this.m) + this.e * 3.0 * LN10); }
  /** Log(double base) @42d51ec */
  log(base) { return new BigNumber(Math.log(this.m) / Math.log(base) + Math.log(10) / Math.log(base) * (this.e * 3.0)); }

  /** PowChunk @42d504c */
  _powChunk(p) {
    const a = Math.pow(this.m, p);
    const x = this.e * p;
    let w = x === Infinity ? -2147483648 : castSat(Math.trunc(x), -2147483648, 2147483647);
    const f = x - w;
    return new BigNumber(a * Math.pow(1000, f), w);
  }

  /** Pow(double) @42d4e78 (instance method: this ^ p) */
  pow(p) {
    if (p === 0) return ONE;
    if (p === 1) return this;
    if (this.m === 0) return ZERO;
    if (p >= 0) {
      const lnm = Math.log(this.m);
      let d = p;
      if (709.782712893384 < lnm * p) { do { d *= 0.5; } while (709.782712893384 < lnm * d); }
      let r = ONE;
      for (; p > 0; p -= (p <= d ? p : d)) {
        const c = p <= d ? p : d;
        const pc = this._powChunk(c);
        r = new BigNumber(r.m * pc.m, r.e + pc.e);
      }
      return r;
    }
    return this._powChunk(p);
  }

  // ---- text -------------------------------------------------------------
  /** Scientific text like the sheet strings: "1.00E+538" (digits = mantissa decimals). Not the game's UI formatter. */
  toSci(digits = 2) {
    if (this.m === 0) return (0).toFixed(digits) + 'E+00';
    const e10 = this.e * 3 + Math.floor(Math.log10(Math.abs(this.m)));
    const mant = this.m / Math.pow(10, Math.floor(Math.log10(Math.abs(this.m))));
    return mant.toFixed(digits) + 'E' + (e10 < 0 ? '-' : '+') + String(Math.abs(e10)).padStart(2, '0');
  }
  toString() { return this.toSci(); }

  /**
   * BigNumberFormat.TryParse @42d8bfc. Accepts "1.00E+538", "12345", "-5E-3".
   * Returns BigNumber or null on failure. Magnitude-name suffixes ("K","M","aa"...) are NOT supported (fail).
   */
  static tryParse(str) {
    if (str == null) return ZERO; // string.IsNullOrEmpty -> true, Zero (@42d8a58)
    const s = String(str).trim();
    if (s === '') return ZERO;
    let k = 0;
    while (k < s.length) {
      const c = s.charCodeAt(k);
      if ((c >= 0x30 && c < 0x3a) || (c >= 0x2b && c <= 0x2e)) k++; else break;
    }
    if (k === 0) return null;
    const n = parseFloat(s.slice(0, k).replace(/,/g, ''));
    if (Number.isNaN(n)) return null;
    const rest = s.slice(k).trim();
    if (rest === '') return new BigNumber(n);
    if ((rest.charCodeAt(0) | 0x20) === 0x65) {
      const t = rest.slice(1);
      if (!/^\s*[+-]?\d+\s*$/.test(t)) return null;
      const e10 = parseInt(t, 10);
      const e3 = Math.floor(e10 / 3);
      return new BigNumber(n * [1, 10, 100][e10 - 3 * e3], e3);
    }
    return null;
  }
  /** C.ParseBigNumberCached @4138a50: failure -> Zero. Memoized. */
  static parse(str) {
    let v = cache.get(str);
    if (v === undefined) { v = BigNumber.tryParse(str) ?? ZERO; cache.set(str, v); }
    return v;
  }
}

const cache = new Map();
const ZERO = new BigNumber(0);
const ONE = new BigNumber(1);

function roundEven(x) {
  const i = Math.trunc(x);
  const f = x - i;
  if (f === 0.5 || f === -0.5) return i % 2 !== 0 ? i + Math.sign(x) : i;
  return Math.trunc(x + (x >= 0 ? 0.5 : -0.5));
}
function castSat(x, lo, hi) {
  if (x === Infinity) return lo; // game quirk: +Inf -> MinValue
  if (Number.isNaN(x)) return 0;
  return x < lo ? lo : x > hi ? hi : x;
}

export const parseBigNumber = BigNumber.parse;
