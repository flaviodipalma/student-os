// Small, deterministic statistics for adaptive planning. No randomness, no
// training: the same history always gives the same answer.

export type Weighted = { value: number; weight: number }

// The value where half the weight is below and half above.
export function weightedMedian(values: Weighted[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, v) => sum + v.weight, 0)
  let seen = 0
  for (const v of sorted) {
    seen += v.weight
    if (seen >= total / 2) return v.value
  }
  return sorted[sorted.length - 1].value
}

export function median(values: number[]): number {
  return weightedMedian(values.map((value) => ({ value, weight: 1 })))
}

// Drops outliers (a 240-minute assignment among 60-75-minute ones) with the
// median absolute deviation: anything further than 3 MADs from the median (at
// least 10% of it) is left out. Returns what's kept, its median and how spread
// out it is (MAD / median: 0 = all the same).
export function robustSummary(values: Weighted[]): { kept: Weighted[]; median: number; spread: number } {
  const first = weightedMedian(values)
  const mad = median(values.map((v) => Math.abs(v.value - first)))
  const limit = 3 * Math.max(mad, 0.1 * Math.abs(first))
  const kept = values.length >= 3 ? values.filter((v) => Math.abs(v.value - first) <= limit) : values
  const middle = weightedMedian(kept)
  const spread = kept.length > 1 ? median(kept.map((v) => Math.abs(v.value - middle))) / Math.abs(middle || 1) : 1
  return { kept, median: middle, spread }
}

// Newer history counts more: weight halves every 90 days.
export function recencyWeight(ageDays: number): number {
  return 0.5 ** (Math.max(0, ageDays) / 90)
}
