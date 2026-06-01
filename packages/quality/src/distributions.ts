/**
 * Numerical primitives: the standard-normal CDF, its inverse (quantile), and
 * the regularized lower incomplete gamma function used for chi-square tail
 * probabilities. No external dependency — these are the building blocks every
 * test in ./statistics.ts relies on, so they are implemented carefully and
 * pinned by tests against known reference values.
 */

/**
 * Standard-normal cumulative distribution function Φ(z).
 *
 * Uses the Abramowitz & Stegun 7.1.26 rational approximation of erf, which is
 * accurate to ~1.5e-7 absolute — more than adequate for the p-values we
 * report (we never claim more than 4 significant figures).
 */
export function normalCdf(z: number): number {
  // Φ(z) = 0.5 * (1 + erf(z / sqrt(2)))
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Error function via Abramowitz & Stegun 7.1.26. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Inverse standard-normal CDF (probit / quantile function).
 *
 * Peter Acklam's rational approximation; relative error < 1.15e-9 across the
 * full domain. Returns ±Infinity at the boundaries.
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Coefficients for the rational approximation.
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Upper-tail probability of a chi-square distribution with `df` degrees of
 * freedom evaluated at `x`: P(X > x). Implemented via the regularized upper
 * incomplete gamma function Q(df/2, x/2).
 */
export function chiSquareSf(x: number, df: number): number {
  if (x <= 0) return 1;
  return regularizedGammaQ(df / 2, x / 2);
}

/** ln Γ(x) via the Lanczos approximation. */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula.
    return (
      Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
    );
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularized upper incomplete gamma Q(s, x) = 1 - P(s, x).
 * Uses the series expansion for x < s+1 and the continued fraction otherwise
 * (Numerical Recipes §6.2).
 */
export function regularizedGammaQ(s: number, x: number): number {
  if (x <= 0) return 1;
  if (x < s + 1) {
    return 1 - gammaSeries(s, x);
  }
  return gammaContinuedFraction(s, x);
}

function gammaSeries(s: number, x: number): number {
  const maxIter = 300;
  const eps = 1e-14;
  let sum = 1 / s;
  let term = sum;
  let n = s;
  for (let i = 0; i < maxIter; i++) {
    n += 1;
    term *= x / n;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * eps) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

function gammaContinuedFraction(s: number, x: number): number {
  const maxIter = 300;
  const eps = 1e-14;
  const tiny = 1e-30;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

/**
 * Two-sided tail probability of a Binomial(n, 0.5) at least as extreme as k
 * successes. Used by the exact McNemar test. Computed exactly via log-binomial
 * coefficients to stay stable for moderate n.
 */
export function binomialTwoSidedP(k: number, n: number): number {
  if (n === 0) return 1;
  const kk = Math.min(k, n - k);
  let tail = 0;
  for (let i = 0; i <= kk; i++) {
    tail += Math.exp(logChoose(n, i) - n * Math.log(2));
  }
  return Math.min(1, 2 * tail);
}

export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}
