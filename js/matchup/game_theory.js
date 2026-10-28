// Two-player zero-sum matrix games, exactly (small dense simplex): the row player maximises A[i][j], the column player minimises it.
//
//   solveZeroSum(A) -> {value, row: [p_i], col: [q_j]}
//
// The row strategy guarantees at least `value` against every column, the column strategy at most `value` against every row
// (tests check both certificates). Sizes here are at most 3 x 3 (Conquest bans) and 2 x 2 (Conquest games).

const EPS = 1e-12;

export function solveZeroSum(A) {
  const m = A.length;
  const n = A[0].length;
  if (m === 1) {
    let j = 0;
    for (let k = 1; k < n; k++) if (A[0][k] < A[0][j] - EPS) j = k;
    return { value: A[0][j], row: [1], col: onehot(n, j) };
  }
  if (n === 1) {
    let i = 0;
    for (let k = 1; k < m; k++) if (A[k][0] > A[i][0] + EPS) i = k;
    return { value: A[i][0], row: onehot(m, i), col: [1] };
  }
  // Pure saddle point first (exact and stable).
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const v = A[i][j];
      let ok = true;
      for (let k = 0; k < n && ok; k++) if (A[i][k] < v - EPS) ok = false;
      for (let k = 0; k < m && ok; k++) if (A[k][j] > v + EPS) ok = false;
      if (ok) return { value: v, row: onehot(m, i), col: onehot(n, j) };
    }
  }
  // Shift to a positive game; the column player's LP: max sum(y) s.t. B y <= 1, y >= 0; value = 1 / sum(y) - shift.
  let lo = Infinity;
  for (const r of A) for (const v of r) lo = Math.min(lo, v);
  const shift = 1 - lo;
  // Tableau: m constraint rows, columns n structural + m slack + rhs.
  const W = n + m + 1;
  const T = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(W);
    for (let j = 0; j < n; j++) row[j] = A[i][j] + shift;
    row[n + i] = 1;
    row[W - 1] = 1;
    T.push(row);
  }
  const obj = new Float64Array(W);
  for (let j = 0; j < n; j++) obj[j] = -1;
  const basis = [];
  for (let i = 0; i < m; i++) basis.push(n + i);
  for (let iter = 0; iter < 200; iter++) {
    // Bland's rule: the lowest index with a negative reduced cost enters.
    let e = -1;
    for (let j = 0; j < n + m; j++) if (obj[j] < -EPS) { e = j; break; }
    if (e < 0) break;
    let r = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][e] > EPS) {
        const ratio = T[i][W - 1] / T[i][e];
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[r])) {
          best = ratio;
          r = i;
        }
      }
    }
    if (r < 0) throw new Error('unbounded game LP');
    const piv = T[r][e];
    for (let j = 0; j < W; j++) T[r][j] /= piv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = T[i][e];
      if (f !== 0) for (let j = 0; j < W; j++) T[i][j] -= f * T[r][j];
    }
    const f = obj[e];
    for (let j = 0; j < W; j++) obj[j] -= f * T[r][j];
    basis[r] = e;
  }
  const y = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) y[basis[i]] = T[i][W - 1];
  const total = y.reduce((s, v) => s + v, 0);
  const x = [];
  for (let i = 0; i < m; i++) x.push(Math.max(0, obj[n + i]));       // the duals: the slack columns' reduced costs
  const xt = x.reduce((s, v) => s + v, 0);
  const value = 1 / total - shift;
  return { value, row: x.map((v) => v / xt), col: y.map((v) => v / total) };
}

function onehot(k, i) {
  const out = new Array(k).fill(0);
  out[i] = 1;
  return out;
}

// The payoff of mixed strategies (row x, col y).
export function payoff(A, x, y) {
  let s = 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < A[0].length; j++) s += x[i] * A[i][j] * y[j];
  return s;
}
