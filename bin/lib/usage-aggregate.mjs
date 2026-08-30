/**
 * bin/lib/usage-aggregate.mjs — pure helpers that group unified usage rows
 * (the shape produced by usage-normalize.mjs) into summary buckets.
 *
 * Kept separate from the readers and normalizers so aggregation logic can be
 * unit-tested in isolation without touching the filesystem or printing anything.
 */

/**
 * Named thresholds for the bottleneck-detection metrics below. Exported so
 * tests and callers can read the exact cutoffs in one place.
 */
export const STEPS_PER_FILE_STDEV_THRESHOLD = 1.5;
export const ATTACH_RATE_THRESHOLD = 0.8;
export const WALL_S_ZSCORE_THRESHOLD = 2;

/**
 * Group unified rows by a composite '<source>/<model>' key so that the same
 * model name from opencode and Claude Code never silently merges into one
 * bucket. Each bucket accumulates run count, ok count, total cost, and summed
 * token fields (treating null as 0).
 */
export function byModel(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.source || 'unknown'}/${r.model || 'unknown'}`;
    const e = by.get(k) || {
      count: 0,
      okCount: 0,
      totalCost: 0,
      tokens: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    };
    e.count++;
    if (r.ok === true) e.okCount++;
    e.totalCost += r.cost_usd || 0;
    e.tokens.input += r.tokens?.input ?? 0;
    e.tokens.output += r.tokens?.output ?? 0;
    e.tokens.cache_write += r.tokens?.cache_write ?? 0;
    e.tokens.cache_read += r.tokens?.cache_read ?? 0;
    by.set(k, e);
  }
  return by;
}

/**
 * Group unified rows by a composite '<source>/<repo>' key so that the same
 * repo name from opencode and Claude Code never silently merges into one
 * bucket. Accumulates the same fields as byModel.
 */
export function byRepo(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.source || 'unknown'}/${r.repo || 'unknown'}`;
    const e = by.get(k) || {
      count: 0,
      okCount: 0,
      totalCost: 0,
      tokens: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    };
    e.count++;
    if (r.ok === true) e.okCount++;
    e.totalCost += r.cost_usd || 0;
    e.tokens.input += r.tokens?.input ?? 0;
    e.tokens.output += r.tokens?.output ?? 0;
    e.tokens.cache_write += r.tokens?.cache_write ?? 0;
    e.tokens.cache_read += r.tokens?.cache_read ?? 0;
    by.set(k, e);
  }
  return by;
}

/**
 * Group unified rows by a composite '<source>/<YYYY-MM-DD>' key so that the
 * same calendar date from opencode and Claude Code never silently merges into
 * one bucket. The date part is taken by string-slicing the ISO timestamp so no
 * timezone conversion occurs. Accumulates the same fields as byModel.
 */
export function byDay(rows) {
  const by = new Map();
  for (const r of rows) {
    const day = String(r.ts || '').slice(0, 10) || 'unknown';
    const k = `${r.source || 'unknown'}/${day}`;
    const e = by.get(k) || {
      count: 0,
      okCount: 0,
      totalCost: 0,
      tokens: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    };
    e.count++;
    if (r.ok === true) e.okCount++;
    e.totalCost += r.cost_usd || 0;
    e.tokens.input += r.tokens?.input ?? 0;
    e.tokens.output += r.tokens?.output ?? 0;
    e.tokens.cache_write += r.tokens?.cache_write ?? 0;
    e.tokens.cache_read += r.tokens?.cache_read ?? 0;
    by.set(k, e);
  }
  return by;
}

/**
 * Detect opencode tasks that touched surprisingly few files for their model's
 * typical step count. stepsPerFile is ext.steps / max(1, ext.touched). For
 * each model group with at least 2 rows, compute the mean and population stdev
 * of stepsPerFile, then flag any row whose stepsPerFile exceeds
 * mean + STEPS_PER_FILE_STDEV_THRESHOLD * stdev. Groups whose stdev is 0 are
 * skipped entirely so a zero-spread group never floods findings. Returns one
 * finding per flagged row.
 */
export function underSeededTasks(rows) {
  const findings = [];
  const by = new Map();
  for (const r of rows) {
    if (r.source !== 'opencode') continue;
    const touched = Math.max(1, r.ext?.touched ?? 0);
    const stepsPerFile = (r.ext?.steps ?? 0) / touched;
    const k = r.model;
    const list = by.get(k) || [];
    list.push({ r, stepsPerFile });
    by.set(k, list);
  }
  for (const [model, list] of by) {
    if (list.length < 2) continue;
    const values = list.map((e) => e.stepsPerFile);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);
    if (stdev === 0) continue;
    const threshold = mean + STEPS_PER_FILE_STDEV_THRESHOLD * stdev;
    for (const { r, stepsPerFile } of list) {
      if (stepsPerFile > threshold) {
        findings.push({
          metric: 'under_seeded',
          group: r.model,
          value: stepsPerFile,
          threshold,
          flagged: true,
          evidence: {
            session: r.ext?.session ?? null,
            steps: r.ext?.steps ?? 0,
            touched: r.ext?.touched ?? 0,
          },
        });
      }
    }
  }
  return findings;
}

/**
 * Detect opencode models that produce ok runs which touch zero files. For each
 * model group, rate = count(ok && touched===0) / count(ok); a group with no ok
 * runs is skipped entirely. Returns one finding per model group, flagged
 * whenever rate > 0.
 */
export function wastedDispatches(rows) {
  const findings = [];
  const by = new Map();
  for (const r of rows) {
    if (r.source !== 'opencode') continue;
    const k = r.model;
    const e = by.get(k) || { model: k, okCount: 0, wastedCount: 0 };
    if (r.ok === true) {
      e.okCount++;
      if ((r.ext?.touched ?? 0) === 0) e.wastedCount++;
    }
    by.set(k, e);
  }
  for (const { model, okCount, wastedCount } of by.values()) {
    if (okCount === 0) continue;
    const rate = wastedCount / okCount;
    findings.push({
      metric: 'wasted_dispatch',
      group: model,
      value: rate,
      threshold: null,
      flagged: rate > 0,
      evidence: { wastedCount, okCount },
    });
  }
  return findings;
}

/**
 * Detect opencode models whose warm-server attach rate falls below the
 * threshold. Considers only rows where ext.attached is a boolean. Produces one
 * finding per model group plus one overall '(all models)' group, flagged when
 * attachRate < ATTACH_RATE_THRESHOLD.
 */
export function missingWarmServer(rows) {
  const findings = [];
  const by = new Map();
  let overallAttached = 0;
  let overallTotal = 0;
  for (const r of rows) {
    if (r.source !== 'opencode') continue;
    if (typeof r.ext?.attached !== 'boolean') continue;
    const k = r.model;
    const e = by.get(k) || { model: k, attachedCount: 0, totalCount: 0 };
    e.totalCount++;
    if (r.ext.attached === true) e.attachedCount++;
    by.set(k, e);
    overallTotal++;
    if (r.ext.attached === true) overallAttached++;
  }
  for (const { model, attachedCount, totalCount } of by.values()) {
    const attachRate = attachedCount / totalCount;
    findings.push({
      metric: 'missing_warm_server',
      group: model,
      value: attachRate,
      threshold: ATTACH_RATE_THRESHOLD,
      flagged: attachRate < ATTACH_RATE_THRESHOLD,
      evidence: { attachedCount, totalCount },
    });
  }
  if (overallTotal > 0) {
    const attachRate = overallAttached / overallTotal;
    findings.push({
      metric: 'missing_warm_server',
      group: '(all models)',
      value: attachRate,
      threshold: ATTACH_RATE_THRESHOLD,
      flagged: attachRate < ATTACH_RATE_THRESHOLD,
      evidence: { attachedCount: overallAttached, totalCount: overallTotal },
    });
  }
  return findings;
}

/**
 * Detect opencode ok runs whose wall-clock time is a high outlier for their
 * model. For each model group with at least 2 rows, compute the mean and
 * population stdev of ext.wall_s, then flag any row whose z-score
 * (wall_s - mean) / stdev exceeds WALL_S_ZSCORE_THRESHOLD. Groups whose stdev
 * is 0 are skipped entirely. Returns one finding per flagged row.
 */
export function wallTimeOutliers(rows) {
  const findings = [];
  const by = new Map();
  for (const r of rows) {
    if (r.source !== 'opencode') continue;
    if (r.ok !== true) continue;
    const k = r.model;
    const list = by.get(k) || [];
    list.push(r);
    by.set(k, list);
  }
  for (const [model, list] of by) {
    if (list.length < 2) continue;
    const values = list.map((r) => r.ext?.wall_s ?? 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);
    if (stdev === 0) continue;
    for (const r of list) {
      const z = ((r.ext?.wall_s ?? 0) - mean) / stdev;
      if (z > WALL_S_ZSCORE_THRESHOLD) {
        findings.push({
          metric: 'wall_time_outlier',
          group: model,
          value: z,
          threshold: WALL_S_ZSCORE_THRESHOLD,
          flagged: true,
          evidence: {
            session: r.ext?.session ?? null,
            wall_s: r.ext?.wall_s ?? 0,
          },
        });
      }
    }
  }
  return findings;
}
