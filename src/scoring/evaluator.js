'use strict';

/**
 * Catalog-driven metric evaluation functions.
 *
 * These functions evaluate metric values against their catalog-defined
 * evaluation_config and return a score + pass/fail status.
 *
 * Optional context (added in v1.5.0):
 * - systemFacts      — { ram_kb, cpu_count, storage_size_kb, ... }
 * - workloadProfile  — 'oltp' | 'olap' | 'mixed' | 'default'
 *
 * The context enables size-relative thresholds (min_pct / max_pct of an anchor
 * such as ram_kb) and profile-keyed thresholds. Both shapes are optional;
 * metrics that use only flat min/max behave identically to v1.4.0.
 */

// Single source of truth for the anchor whitelist lives in the shared
// validation module; re-exported below for backward compatibility.
const { RECOGNIZED_ANCHORS } = require('../catalog/validation');
const { SCORING_POLICY } = require('./policy');
const { evaluatePredicate } = require('./consistency');
const PARTIAL = SCORING_POLICY.partialCredit;

// Values that look filled-in but mean "nothing configured" — rejected by the
// not_empty_or_dummy check (matched case-insensitively after trim). Ported
// from db-health-checker's Oracle report-accuracy fix.
const DUMMY_SENTINELS = new Set([
  '/bin/true',
  '(disabled)',
  'none',
  'unavailable',
  'n/a',
  'na',
  'error',
  'unknown',
  'null',
  'undefined',
]);

/**
 * Resolve the effective threshold config for a metric, applying profile
 * selection and size-relative resolution.
 *
 * Returns the resolved bounds for {@link evaluateThreshold} plus optional
 * diagnostic fields:
 * - `_derivation`: human-readable description of how a bound was derived
 * - `_unresolved`: true when no fact and no absolute_floor were available
 *
 * @param {Object} config - The metric's evaluation_config
 * @param {Object} [ctx]  - { systemFacts, workloadProfile }
 * @returns {Object} resolved config with min/max plus optional metadata
 */
function resolveThresholdConfig(config, ctx = {}) {
  if (!config || typeof config !== 'object') return {};

  // 0. Declaration-keyed selection (v1.14.0) — when `by_declaration` is present,
  //    a declared target metric's value selects a band of bounds that overrides
  //    the base min/max/unit. An undeclared, empty, or unmatched value falls back
  //    to an explicit `bands.default` if present, otherwise to the base config, so
  //    estates that declared nothing score EXACTLY as before this feature. This is
  //    how "backup age <= my declared RPO" is expressed without engine branches.
  //    Mutually exclusive with `profiles` (enforced by the catalog validator).
  //    Optional `unless` (1.15.0): a predicate in the consistency-rule language;
  //    when it holds, the declaration is ignored and the metric scores as if
  //    undeclared. Example: backup age stops tracking the declared RPO when WAL
  //    archiving carries the recovery point instead of the base backup.
  let baseCfg = config;
  let declDerivation = null;
  if (config.by_declaration && typeof config.by_declaration === 'object') {
    const decl = config.by_declaration;
    const values = (ctx && ctx.values) || {};
    const raw = values[decl.metric];
    const skipped = !!(decl.unless && evaluatePredicate(decl.unless, values, ctx || {}));
    const key = (skipped || raw === undefined || raw === null || raw === '') ? null : String(raw).toLowerCase();
    const bands = decl.bands || {};
    let band = null;
    if (key !== null && bands[key] !== undefined) band = bands[key];
    else if (bands.default !== undefined) band = bands.default;
    if (band) {
      baseCfg = { ...config, ...band };
      declDerivation = skipped
        ? `bounds as undeclared: the ${decl.metric} bands do not apply (unless condition holds)`
        : `bounds from declared ${decl.metric}=${key === null ? 'undeclared' : key}`;
    } else if (skipped) {
      declDerivation = `bounds as undeclared: the ${decl.metric} bands do not apply (unless condition holds)`;
    }
  }

  // 1. Profile selection — if `profiles` is present, pick the active profile
  //    and fall back through the requested profile -> 'default' -> {} chain.
  let cfg = baseCfg;
  if (baseCfg.profiles && typeof baseCfg.profiles === 'object') {
    const profile = ctx.workloadProfile || 'default';
    cfg = baseCfg.profiles[profile]
      || baseCfg.profiles.default
      || {};
  }

  // 2. Size-relative resolution — *_pct + *_pct_of -> absolute min/max.
  //    If the required systemFact is missing, fall back to absolute_floor;
  //    if there's no fallback either, mark the config _unresolved so the
  //    evaluator can skip the metric without producing a misleading score.
  const resolved = {};
  if (cfg.min !== undefined) resolved.min = cfg.min;
  if (cfg.max !== undefined) resolved.max = cfg.max;
  if (cfg.unit !== undefined) resolved.unit = cfg.unit;
  if (declDerivation) resolved._derivation = declDerivation;

  if (cfg.min_pct !== undefined && cfg.min_pct_of) {
    const base = ctx.systemFacts && ctx.systemFacts[cfg.min_pct_of];
    if (typeof base === 'number' && base > 0) {
      resolved.min = base * (cfg.min_pct / 100);
      resolved._derivation = `min = ${cfg.min_pct}% of ${cfg.min_pct_of}=${base}`;
    } else if (cfg.absolute_floor && cfg.absolute_floor.min !== undefined) {
      resolved.min = cfg.absolute_floor.min;
      resolved._derivation = `min = absolute_floor (no ${cfg.min_pct_of})`;
      resolved._fallback = true;
    } else {
      resolved._unresolved = true;
    }
  }

  if (cfg.max_pct !== undefined && cfg.max_pct_of) {
    const base = ctx.systemFacts && ctx.systemFacts[cfg.max_pct_of];
    if (typeof base === 'number' && base > 0) {
      resolved.max = base * (cfg.max_pct / 100);
      const prefix = resolved._derivation ? resolved._derivation + '; ' : '';
      resolved._derivation = `${prefix}max = ${cfg.max_pct}% of ${cfg.max_pct_of}=${base}`;
    } else if (cfg.absolute_floor && cfg.absolute_floor.max !== undefined) {
      resolved.max = cfg.absolute_floor.max;
      const prefix = resolved._derivation ? resolved._derivation + '; ' : '';
      resolved._derivation = `${prefix}max = absolute_floor (no ${cfg.max_pct_of})`;
      resolved._fallback = true;
    } else {
      resolved._unresolved = true;
    }
  }

  return resolved;
}

/**
 * Evaluate an enum metric — value must be in a list of passing values.
 * @param {string} value - The metric value
 * @param {string[]} passValues - List of acceptable values
 * @param {number} maxPoints - Maximum points for this metric
 * @returns {number} Score (maxPoints if pass, 0 if fail)
 */
function evaluateEnum(value, passValues, maxPoints) {
  if (value === null || value === undefined || value === '') return 0;
  const v = String(value).toLowerCase();
  const passes = passValues.map(p => String(p).toLowerCase());
  return passes.includes(v) ? maxPoints : 0;
}

/**
 * Evaluate a threshold metric using catalog config.
 * Handles min (higher-is-better), max (lower-is-better), or both (range).
 *
 * Scoring:
 * - Full points if within bounds
 * - Partial credit (policy factor, 50%) if within the policy multiple (2x) of
 *   the bounds. Never rounded: rounding a weight-1 metric's half point back to
 *   1 used to award full credit, and "passed", to a value outside its bounds.
 * - 0 if outside that band
 *
 * @param {number} value - The metric value
 * @param {Object} config - { min?: number, max?: number }
 * @param {number} maxPoints - Maximum points for this metric
 * @returns {number} Score
 */
/**
 * Whether a value sits inside a resolved threshold's bounds. "passed" for a
 * threshold or range metric comes from this, never from the awarded points
 * (1.15.0): points are a consequence of the criterion, not its proof.
 */
function withinBounds(value, config) {
  if (value === null || value === undefined || value === '') return false;
  const v = parseFloat(value);
  if (isNaN(v)) return false;
  if (config.min !== undefined && v < config.min) return false;
  if (config.max !== undefined && v > config.max) return false;
  return true;
}

function evaluateThreshold(value, config, maxPoints) {
  if (value === null || value === undefined || value === '') return 0;
  const v = parseFloat(value);
  if (isNaN(v)) return 0;

  let pass = true;
  let partial = true;

  if (config.min !== undefined) {
    if (v < config.min) pass = false;
    if (v < config.min / PARTIAL.withinMultiple) partial = false;
  }
  if (config.max !== undefined) {
    if (v > config.max) pass = false;
    if (v > config.max * PARTIAL.withinMultiple) partial = false;
  }

  if (pass) return maxPoints;
  if (partial) return maxPoints * PARTIAL.factor;
  return 0;
}

/**
 * Catalog-driven evaluation dispatcher.
 * Routes to the correct evaluation function based on the metric's evaluation_type.
 *
 * Supported evaluation types:
 * - boolean: pass/fail check (supports not_empty_or_dummy special check)
 * - enum: value must be in a list of pass_values
 * - threshold: value within min/max bounds with partial credit
 * - range: alias for threshold
 *
 * @param {Object} metric - Metric definition from catalog
 * @param {*} value - The collected value
 * @param {number} maxPoints - Maximum points for this metric
 * @param {Object} [ctx]   - { systemFacts, workloadProfile } — optional
 * @returns {{ score: number, passed: boolean, unresolved?: boolean, fallback?: boolean, derivation?: string }}
 */
function evaluateMetric(metric, value, maxPoints, ctx = {}) {
  if (value === null || value === undefined || value === '') {
    return { score: 0, passed: false };
  }

  let score = 0;
  const config = metric.evaluation_config || {};

  switch (metric.evaluation_type) {
    case 'boolean': {
      const expected = config.pass_value !== undefined ? config.pass_value : true;
      if (config.check === 'not_empty_or_dummy') {
        const v = String(value).trim();
        const isDummy = !v || DUMMY_SENTINELS.has(v.toLowerCase());
        score = isDummy ? 0 : maxPoints;
      } else if (config.check === 'not_empty') {
        score = String(value).trim() ? maxPoints : 0;
      } else {
        const v = typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
        score = v === expected ? maxPoints : 0;
      }
      break;
    }

    case 'enum': {
      const passValues = config.pass_values || [];
      score = evaluateEnum(value, passValues, maxPoints);
      break;
    }

    case 'threshold':
    case 'range': {
      const resolved = resolveThresholdConfig(config, ctx);
      if (resolved._unresolved) {
        return { score: 0, passed: false, unresolved: true };
      }
      score = evaluateThreshold(value, resolved, maxPoints);
      const result = { score, passed: withinBounds(value, resolved) };
      if (resolved._fallback) result.fallback = true;
      if (resolved._derivation) result.derivation = resolved._derivation;
      return result;
    }

    default:
      // Unknown evaluation_type: never award points (fail closed).
      score = 0;
  }

  return { score, passed: score >= maxPoints };
}

module.exports = {
  evaluateMetric,
  evaluateEnum,
  evaluateThreshold,
  resolveThresholdConfig,
  RECOGNIZED_ANCHORS,
};
