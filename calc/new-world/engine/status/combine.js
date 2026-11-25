import { BigNumber } from '../bignum.js';

const { ONE } = BigNumber;

/** generic dictionary helper @4c93c28: cur undefined = key missing. */
export function combine(cur, vt, v) {
  if (cur === undefined) {
    if (vt === 4) return v.rdiv(1);
    if (vt === 2) return ONE.add(v.mul(0.01));
    return v;
  }
  if (vt === 1) return cur.add(v);
  if (vt === 2) return cur.mul(ONE.add(v.mul(0.01)));
  if (vt === 3) return cur.mul(v);
  if (vt === 4) return cur.div(v);
  return cur.gt(v) ? cur : v;
}
