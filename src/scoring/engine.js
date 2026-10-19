'use strict';

/**
 * Catalog-Driven Scoring Engine
 *
 * Scores metrics from any collection source using the JSON metric catalog.
 * Implements subcategory-level scoring with criticality gates.
 *
 * Scoring model:
 * 1. Each metric has an effective weight (criticality-based or override)
 * 2. Within a subcategory, metric scores are weighted-normalized to fit maxPoints
 * 3. If ANY critical metric fails -> subcategory score capped at 60%
 * 4. Pillar score = sum of subcategory scores (capped at pillar maxPoints)
 * 5. Total = sum of pillar scores
 * 6. maxScore is dynamic -- only active metrics contribute
 * 7. Target (1.16.0): the points of the checks the declared targets require.
 *    A check whose optional_when holds still counts but is not required: it
 *    never gates and leaves the target. Status follows the points earned on
 *    required checks divided by the target; "excellent" only when on target.
 * 8. Absolute target (1.17.0): every applicable check stays on the ruler
 *    whether it was collected or not, including checks outside the run's
 *    collection scope. An uncollected check counts 0 points, stays in the
 *    target when required and is reported in pointsNotAssessed. A check the
 *    run had no means to collect (outOfScope) never triggers a gate or cap.
 */

const { catalog, getCatalog, effectiveServerVersion, compareVersions } = require('../catalog');
const { MIN_VERSION_FIELDS } = require('../catalog/constants');
const { evaluateMetric } = require('./evaluator');
const { evaluatePredicate, evaluateRules, applyAdjustments, annotateMovement } = require('./consistency');
const { version: ENGINE_VERSION } = require('../../package.json');

// Pillar criticality cap (v1.14.0): fraction of a pillar's maxPoints a hard-
// failed or missing critical metric caps the pillar to. 0.6 mirrors the
// subcategory 60% gate, escalated one level (see the pillar rollup below).
// Shared scoring rules live in src/scoring/policy.js (v1.15.0): the gates,
// the status bands and the engine defaults are read from there, never typed
// here.
const { SCORING_POLICY } = require('./policy');
const { predicateMetrics } = require('../catalog/validation');
const { declarationsOf, fingerprints, normalizeDeclaration } = require('../fingerprint');
const PILLAR_CRIT_CAP_PCT = SCORING_POLICY.pillarCriticalCapPct;
const SUBCAT_GATE_CAP_PCT = SCORING_POLICY.subcategoryGateCapPct;
const DEFAULT_RESTORE_THROUGHPUT_MB_S = SCORING_POLICY.defaults.restoreThroughputMbPerSecond;
const STATUS_BANDS = SCORING_POLICY.statusBands;

/**
 * Derived-metric formulas (v1.6.0+).
 *
 * Each entry takes a {values, systemFacts} bundle and returns either a number
 * (the computed metric value, written back into `values` under the metric's
 * legacy_name) or `null` when any required input is missing — the engine then
 * treats the derived metric as "not provided" using the same path it uses for
 * missing collector values.
 *
 * Adding a formula: register a handler here, mark the metric `derived: true`
 * in the catalog, and declare the inputs in `derived_from.inputs`. The
 * validator (scripts/validate-catalogs.js) cross-checks that every input
 * either names a real metric legacy_name or a recognised systemFacts anchor.
 */
const DERIVED_FORMULAS = {
  // (shared_buffers_bytes + max_connections × work_mem_bytes) / ram_bytes × 100
  memory_pressure_pct({ values, systemFacts }) {
    const sb = parseFloat(values.shared_buffers_bytes);
    const mc = parseFloat(values.max_connections);
    const wm = parseFloat(values.work_mem_bytes);
    const ram = systemFacts && systemFacts.ram_bytes;
    if (!Number.isFinite(sb) || !Number.isFinite(mc) || !Number.isFinite(wm)) return null;
    if (!Number.isFinite(ram) || ram <= 0) return null;
    return Math.round(((sb + mc * wm) / ram * 100) * 100) / 100;
  },

  // wal_buffers_bytes / shared_buffers_bytes (decimal ratio, e.g. 0.03 = 3%)
  wal_buffers_ratio({ values }) {
    const wb = parseFloat(values.wal_buffers_bytes);
    const sb = parseFloat(values.shared_buffers_bytes);
    if (!Number.isFinite(wb) || !Number.isFinite(sb) || sb <= 0) return null;
    return Math.round((wb / sb) * 10000) / 10000;
  },

  // wal_buffers vs PostgreSQL's auto-tune expectation min(shared_buffers/32, 16MB).
  // 1.0 = exactly the auto-tuned value, so a threshold {min: 1} passes
  // auto-tuned defaults at every shared_buffers size (the plain wb/sb ratio
  // falsely failed above ~533MB shared_buffers — dropped from PG in v1.7.0).
  wal_buffers_ratio_capped({ values }) {
    const wb = parseFloat(values.wal_buffers_bytes);
    const sb = parseFloat(values.shared_buffers_bytes);
    if (!Number.isFinite(wb) || !Number.isFinite(sb) || sb <= 0) return null;
    const expected = Math.min(sb / 32, 16777216);
    return Math.round((wb / expected) * 10000) / 10000;
  },

  // Comma-separated list → count of declared entries (after trimming/empty filter).
  count_csv({ values }, inputs) {
    const inputName = inputs && inputs[0];
    if (!inputName) return null;
    const raw = values[inputName];
    // An uncollected list is unknown, not empty (L-011); an empty one counts 0.
    if (raw === null || raw === undefined) return null;
    if (raw === '') return 0;
    return String(raw)
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .length;
  },

  // Oracle: (sga_target + pga_aggregate_target) / ram_bytes × 100.
  // The healthy band lives in the catalog threshold (MAA: ~40–80% on a
  // dedicated DB host — leave ~20% for the OS). Missing inputs → not-provided.
  oracle_memory_pct_of_ram({ values, systemFacts }) {
    const sga = parseFloat(values.sga_target);
    // v1.15.0 (Oracle TL review): the hard cap PGA_AGGREGATE_LIMIT is the real
    // memory footprint when set; fall back to PGA_AGGREGATE_TARGET otherwise.
    const pgaLimit = parseFloat(values.pga_aggregate_limit);
    const pga = Number.isFinite(pgaLimit) && pgaLimit > 0 ? pgaLimit : parseFloat(values.pga_aggregate_target);
    const ram = systemFacts && systemFacts.ram_bytes;
    if (!Number.isFinite(sga) || !Number.isFinite(pga)) return null;
    if (!Number.isFinite(ram) || ram <= 0) return null;
    return Math.round(((sga + pga) / ram * 100) * 100) / 100;
  },

  // Restore-time estimate (v1.15.0): database_size (GB) restored at the
  // attested restore_throughput_mb_s, or at DEFAULT_RESTORE_THROUGHPUT_MB_S
  // when no restore test attested a rate. Minutes, 1 decimal. Scored against
  // the declared RTO rung via by_declaration; only meaningful without HA.
  restore_time_estimate_minutes({ values }) {
    const sizeGb = parseFloat(values.database_size);
    if (!Number.isFinite(sizeGb) || sizeGb < 0) return null;
    const attested = parseFloat(values.restore_throughput_mb_s);
    const mbps = Number.isFinite(attested) && attested > 0 ? attested : DEFAULT_RESTORE_THROUGHPUT_MB_S;
    return Math.round(((sizeGb * 1024) / mbps / 60) * 10) / 10;
  },
};

// Share of the target reached (1.16.0, DEC-029): the points earned on required
// checks divided by the target, so extra effort on checks the targets do not
// require never makes up for a missed required one. 100 only when on target
// (every required check fully met); below that it never reads 100. A target of
// 0 means nothing in scope is required: 100 when something was scored,
// otherwise the historical percentage (0 for an emptied subcategory).
function targetAttainment(requiredScore, target, maxScore, pct, onTarget) {
  if (target > 0) {
    if (onTarget) return 100;
    return Math.min(99, Math.round((requiredScore / target) * 100));
  }
  return maxScore > 0 ? 100 : pct;
}
const round2 = (x) => Math.round(x * 100) / 100;

// A rule deduction or cap can take points the required checks earned without
// failing any one of them (PG-CR-SYNC-1 takes 4 Backup points while
// synchronous_commit=local passes on its own), so being on target also needs
// the required points to reach the target.
const reachesTarget = (required, target) => round2(required) >= round2(target);

// The deductions and caps of a rule finding that actually took points (not
// metric_zero: a zeroed metric is already listed as invalidated). A cap
// records no `applied`, only its prior and new score.
function pointMoves(f) {
  const moves = f.score_movements || (f.score_movement ? [f.score_movement] : []);
  return moves.filter((mv) => mv.type !== 'metric_zero'
    && ((Number(mv.applied) || 0) > 0 || (Number(mv.prior_score) || 0) > (Number(mv.new_score) || 0)));
}

// A required check the estate misses (DEC-029): scored below full points
// (failed, partial credit or invalidated by a rule), or not collected
// (1.17.0: any criticality, in or out of the run's collection scope, except a
// non-critical declared target left blank).
function missesRequired(m) {
  if (m.applicable === false || m.required === false || m.undeclared) return false;
  if (m.scored) return m.score < m.maxScore;
  return true;
}

class ScoringEngine {
  /**
   * @param {string} [technology='postgresql'] - Database technology for catalog loading
   * @param {Object} [options]
   * @param {MetricCatalog} [options.catalog] - score with this catalog instead of
   *   the embedded one (an edited catalog or an imported rules bundle, 1.16.0)
   */
  constructor(technology = 'postgresql', options = {}) {
    this.catalog = options.catalog
      || (technology === 'postgresql' ? catalog : getCatalog(technology));
  }

  /**
   * Calculate scores from a flat collected-values map.
   *
   * @param {Map<string,any>|Object} collectedValues - metric values keyed by legacy_name
   * @param {Object} [options]
   * @param {string} [options.mode='standalone'] - 'standalone' or 'agent'
   * @param {number} [options.pgVersion] - Database version as integer
   * @param {string} [options.deploymentProfile] - deployment profile
   * @param {string[]} [options.installedExtensions] - installed extension names
   * @param {string[]} [options.availableSources] - available sources
   * @param {Object} [options.valueSources] - map of metric_name -> source that provided the value
   * @param {Object} [options.systemFacts] - { ram_kb, cpu_count, storage_size_kb } — required for size-relative thresholds
   * @param {string} [options.workloadProfile='mixed'] - 'oltp' | 'olap' | 'mixed' | 'default'
   * @returns {Object} Assessment result with totalScore, pillars, findings, recommendations
   */
  calculate(collectedValues, options = {}) {
    const {
      mode = 'standalone',
      pgVersion = null,
      serverVersion = null,
      deploymentProfile = null,
      installedExtensions = [],
      availableSources = ['sql', 'manual'],
      valueSources = {},
      systemFacts = {},
      workloadProfile = 'mixed',
      licensedOptions = [],
    } = options;
    // Auto-derive byte siblings so a catalog can use either ram_kb or ram_bytes
    // (the catalog's `unit` field decides which one matches the metric value).
    const derivedFacts = { ...systemFacts };
    if (derivedFacts.ram_kb && derivedFacts.ram_bytes === undefined) {
      derivedFacts.ram_bytes = derivedFacts.ram_kb * 1024;
    }
    if (derivedFacts.storage_size_kb && derivedFacts.storage_size_bytes === undefined) {
      derivedFacts.storage_size_bytes = derivedFacts.storage_size_kb * 1024;
    }
    const evalCtx = { systemFacts: derivedFacts, workloadProfile };

    // Normalize to plain object if Map
    const values = collectedValues instanceof Map
      ? Object.fromEntries(collectedValues)
      : { ...collectedValues };

    // Declared targets in the catalog spelling (1.16.0), so the result, the
    // declarations echo and the fingerprint all carry one spelling. Exact
    // letters otherwise: " rpo_1440" stays an out-of-vocabulary value.
    for (const m of this.catalog.metrics) {
      if (m.declared_target === true && values[m.legacy_name] !== undefined) {
        values[m.legacy_name] = normalizeDeclaration(m, values[m.legacy_name]) ?? values[m.legacy_name];
      }
    }

    // Expose the collected values to the evaluator (v1.14.0) so declaration-
    // keyed thresholds (evaluation_config.by_declaration) can read a declared
    // target's value, e.g. a backup-age bound derived from the declared RPO.
    // Read-only in the evaluator; derived values written below are visible too.
    evalCtx.values = values;

    // Get active metrics for this context. serverVersion is the generic version
    // option (1.15.0); pgVersion stays its alias for existing consumers.
    const effectiveVersion = effectiveServerVersion({ serverVersion, pgVersion });
    const filterOptions = {
      mode, serverVersion: effectiveVersion, deploymentProfile, installedExtensions, availableSources,
    };
    const activeMetrics = this.catalog.getActiveMetrics(filterOptions);
    // The ruler (1.17.0): the checks this run can collect plus the ones that
    // apply to the estate but sit outside its collection scope (agent-only in
    // a standalone run, an undeclared evidence source). The latter are scored
    // as not collected whatever the payload carries for them.
    const scopeExcluded = this.catalog.getScopeExcludedMetrics(filterOptions);
    const outOfScopeSet = new Set(scopeExcluded.map((m) => m.legacy_name));
    const rulerMetrics = activeMetrics.concat(scopeExcluded);

    // Pre-evaluate derived metrics (v1.6.0+). Derived metrics declare a
    // formula in `derived_from.formula`; the engine computes them from
    // collected values + systemFacts and writes the result back into `values`
    // under the metric's legacy_name. Missing inputs → skip; the metric then
    // follows the existing not-provided path in _scoreSubcategory.
    this._computeDerivedMetrics(activeMetrics, values, derivedFacts);

    // Applicability pass (v1.8.0+): metrics whose applies_when predicate is
    // false are excluded from scoring entirely — no points at stake, no
    // criticality gate. Runs AFTER the derived pass so predicates can
    // reference derived values; derived metrics are always computed, even
    // when their own applies_when is false.
    // IMPORTANT: `values` must not be mutated past this point — applicability
    // and rule firing below both read it.
    const notApplicable = new Set();
    const isKnown = (name) => values[name] !== undefined && values[name] !== null && values[name] !== '';
    for (const metric of rulerMetrics) {
      if (metric.applies_when && !evaluatePredicate(metric.applies_when, values, evalCtx)) {
        // Out of scope, the predicate must be known false, as in
        // coverage.outOfScope (L-006): the run could not collect its inputs.
        if (outOfScopeSet.has(metric.legacy_name) && !predicateMetrics(metric.applies_when).every(isKnown)) continue;
        notApplicable.add(metric.legacy_name);
      }
    }
    // Unknown server version (1.17.0): the catalog keeps a version-gated check
    // when the version is absent or unreadable. Its value then decides: a
    // collected value proves the server has it (collectors omit settings an
    // older server lacks), a missing one leaves the check out, so an unknown
    // version never costs the points of a check the server may not have.
    const minVersionField = MIN_VERSION_FIELDS[this.catalog.technology] || 'min_pg_version';
    const versionUnknown = new Set();
    for (const metric of rulerMetrics) {
      const min = metric[minVersionField];
      if (min == null || min === '' || notApplicable.has(metric.legacy_name)) continue;
      const known = effectiveVersion !== null && compareVersions(effectiveVersion, min) !== null;
      const v = values[metric.legacy_name];
      if (!known && (v === undefined || v === null || v === '')) {
        notApplicable.add(metric.legacy_name);
        versionUnknown.add(metric.legacy_name);
      }
    }

    // License/pack applicability (v1.9.0+): a metric whose `license_requirement`
    // is not in the customer's owned set is not-applicable — excluded from
    // numerator, denominator, and gates (no penalty) — AND reported in
    // `licenseExcluded` for score-relevancy transparency. `enterprise_edition`
    // is auto-derived from systemFacts.edition='enterprise'; packs are explicit
    // (entitlement isn't reliably queryable, so the consumer supplies the set).
    // Fail-closed: with no context, pack/EE metrics are simply out of scope.
    const ownedLicenses = new Set(
      (Array.isArray(licensedOptions) ? licensedOptions : []).map((s) => String(s).toLowerCase())
    );
    if (String(derivedFacts.edition || '').toLowerCase() === 'enterprise') {
      ownedLicenses.add('enterprise_edition');
    }
    const licenseExcludedSet = new Set();
    const licenseExcluded = [];
    for (const metric of rulerMetrics) {
      const req = metric.license_requirement;
      if (req && !ownedLicenses.has(String(req).toLowerCase())) {
        notApplicable.add(metric.legacy_name);
        licenseExcludedSet.add(metric.legacy_name);
        const sub = this.catalog.getSubcategory(metric.subcategory);
        licenseExcluded.push({
          name: metric.legacy_name,
          metric_id: metric.metric_id,
          display_name: metric.display_name,
          license_requirement: req,
          subcategory: metric.subcategory,
          pillar: sub ? sub.pillar : null,
        });
      }
    }

    // Requirement pass (1.16.0): a check whose optional_when holds is not
    // required by the declared targets. It still earns or loses its points but
    // leaves the target score and never triggers a criticality gate or the
    // disposition. optional_when reads declared targets only (validator), so a
    // missing declaration keeps the check required.
    const optional = new Map(); // legacy_name -> { declared target: value }
    for (const metric of rulerMetrics) {
      if (!metric.optional_when || notApplicable.has(metric.legacy_name)) continue;
      if (evaluatePredicate(metric.optional_when, values, evalCtx)) {
        const read = [...new Set(predicateMetrics(metric.optional_when))];
        optional.set(metric.legacy_name, Object.fromEntries(read.map((n) => [n, values[n]])));
      }
    }

    // Cross-metric consistency rules — evaluated BEFORE subcategory scoring
    // (rule firing depends only on values + ctx) so metric_zero adjustments
    // can be applied inside the weighted normalization. Rule findings are
    // appended to allFindings after the subcategory loop, preserving the
    // historical finding order. subcategory_cap / subcategory_deduction
    // mutate subcategoryResults afterwards; pillar_deduction is applied
    // during pillar rollup so it can floor against the accumulated score.
    let ruleFindings = [];
    const restAdjustments = [];
    const metricZeroes = new Map(); // legacy_name -> [adjustment, ...]
    const rules = typeof this.catalog.getConsistencyRules === 'function'
      ? this.catalog.getConsistencyRules()
      : [];
    if (rules.length > 0) {
      const { findings, adjustments } = evaluateRules(rules, values, null, this.catalog, evalCtx);
      ruleFindings = findings;
      for (const adj of adjustments) {
        if (adj.type === 'metric_zero') {
          if (!metricZeroes.has(adj.target)) metricZeroes.set(adj.target, []);
          metricZeroes.get(adj.target).push(adj);
        } else {
          restAdjustments.push(adj);
        }
      }
    }

    // Group by subcategory
    const bySubcategory = new Map();
    for (const metric of rulerMetrics) {
      if (!bySubcategory.has(metric.subcategory)) {
        bySubcategory.set(metric.subcategory, []);
      }
      bySubcategory.get(metric.subcategory).push(metric);
    }

    // Score each subcategory
    const subcategoryResults = new Map();
    const allMetrics = [];
    const allFindings = [];

    for (const [subcatId, metrics] of bySubcategory) {
      const subcatDef = this.catalog.getSubcategory(subcatId);
      if (!subcatDef) continue;

      const result = this._scoreSubcategory(
        subcatId, subcatDef, metrics, values, valueSources, evalCtx,
        { notApplicable, metricZeroes, licenseExcludedSet, optional, outOfScopeSet, versionUnknown }
      );
      subcategoryResults.set(subcatId, result);

      for (const m of result.metrics) {
        allMetrics.push({ ...m, pillar: subcatDef.pillar });
      }
      for (const f of result.findings) {
        allFindings.push(f);
      }
    }

    // An unknown server version leaves version-gated checks with no value out
    // (1.17.0): say so, per pillar, so the reader knows to pass serverVersion.
    const unknownByPillar = new Map();
    for (const m of allMetrics) {
      if (m.exclusion_reason !== 'version_unknown') continue;
      if (!unknownByPillar.has(m.pillar)) unknownByPillar.set(m.pillar, []);
      unknownByPillar.get(m.pillar).push(m);
    }
    for (const [pillarId, ms] of unknownByPillar) {
      allFindings.push({
        pillar: pillarId,
        category: (this.catalog.getPillar(pillarId) || {}).name,
        severity: 'info',
        source: 'engine',
        title: `Server version ${effectiveVersion === null ? 'unknown' : `unreadable (${effectiveVersion})`}: ${ms.length} version-gated check${ms.length === 1 ? '' : 's'} not judged`,
        description: `These checks exist only from a given server version and no value was collected for them, so they were left out: ${ms.map((m) => m.display_name).join(', ')}.`,
        remediation: 'Pass serverVersion in the catalog\'s format so version-gated checks are judged.',
      });
    }

    // Rule findings land here (post-subcategory, after the version findings)
    // to keep finding order stable
    // across versions; their score_movement annotations were written by
    // reference during scoring / are written below by applyAdjustments.
    for (const f of ruleFindings) allFindings.push(f);

    let pillarDeductions = new Map();
    if (restAdjustments.length > 0) {
      ({ pillarDeductions } = applyAdjustments(restAdjustments, subcategoryResults));
    }

    // Roll up to pillar scores
    const pillars = {};
    let totalScore = 0;
    const gateZeroedPillars = new Set();

    for (const pillarId of this.catalog.getPillarIds()) {
      const pillarDef = this.catalog.getPillar(pillarId);
      const subcatIds = this.catalog.getSubcategoryIds(pillarId);

      let pillarScore = 0;
      let pillarMaxScore = 0;
      let pillarTarget = 0;
      let pillarRequired = 0;
      let pillarNotAssessed = 0;
      const pillarMetrics = [];

      for (const subcatId of subcatIds) {
        const result = subcategoryResults.get(subcatId);
        if (!result) continue;

        pillarScore += result.score;
        pillarMaxScore += result.maxScore;
        pillarTarget += result.target;
        pillarRequired += Math.min(result.requiredScore, result.score);
        pillarNotAssessed += result.pointsNotAssessed;

        for (const m of result.metrics) {
          pillarMetrics.push(m);
        }
      }

      // Apply pillar_deduction adjustments BEFORE the maxPoints cap so the
      // deduction lands on the realised score, not the post-cap value. Floor
      // at 0; annotate originating findings with score_movement.
      const pdEntry = pillarDeductions.get(pillarId);
      if (pdEntry && pdEntry.points > 0) {
        const priorPillarScore = pillarScore;
        const applied = Math.min(pdEntry.points, priorPillarScore);
        pillarScore = Math.max(0, priorPillarScore - pdEntry.points);
        for (const adj of pdEntry.adjustments) {
          annotateMovement(adj, {
            type: 'pillar_deduction',
            target: pillarId,
            requested: Number(adj.points) || 0,
            applied: Math.round(applied * 100) / 100,
            prior_score: Math.round(priorPillarScore * 100) / 100,
            new_score: Math.round(pillarScore * 100) / 100,
          });
        }
      }

      // Cap at pillar maxPoints and round
      pillarScore = Math.round(Math.min(pillarScore, pillarDef.maxPoints) * 100) / 100;
      pillarMaxScore = Math.min(pillarMaxScore, pillarDef.maxPoints);
      pillarTarget = round2(Math.min(pillarTarget, pillarDef.maxPoints));

      // Pillar zero gate: if any metric with gate_scope='pillar' and
      // criticality='critical' failed on its NATURAL evaluation -> pillar = 0.
      // (metric_zero on a gate metric must not nuke the pillar.)
      const hasPillarGateFailure = pillarMetrics.some(m =>
        m.scored && m.criticality === 'critical' && m.required !== false &&
        ((m.zeroed_by_rules ? m.natural_score : m.score) === 0) &&
        this.catalog.metrics.find(cm => cm.legacy_name === m.name && cm.gate_scope === 'pillar')
      );
      if (hasPillarGateFailure) {
        pillarScore = 0;
        gateZeroedPillars.add(pillarId);
        allFindings.push({
          pillar: pillarId,
          category: pillarDef.name,
          severity: 'critical',
          source: 'engine',
          title: `${pillarDef.name} pillar zeroed — critical gate failure`,
          description: 'A pillar-scoped critical metric failed, setting the entire pillar score to 0.',
          remediation: 'Address the critical gate failure (e.g., upgrade to a supported database version) to restore pillar scoring.',
        });
      }

      // Pillar criticality cap (v1.14.0): a HARD-failed (natural score 0) or
      // MISSING critical metric anywhere in the pillar caps the whole pillar at
      // 60% of maxPoints (12/20). This escalates the subcategory 60% cap one
      // level so a failed foundation is visible on the pillar tile instead of
      // being diluted to a ~2-point dent. Partial credit does NOT trigger it
      // (gates follow the natural evaluation; a metric_zeroed-but-naturally-
      // passing critical is not a hard fail). Skipped when the pillar zero gate
      // already fired (0 is already below the cap). Like pillar_deduction, this
      // is a pillar-scoped adjustment, so the subcategory scores may sum to more
      // than the capped pillar.
      // criticalGated flags the pillar for the UI (chip on the pillar tile) and
      // is true whenever a critical hard-failed/missing OR the pillar zero gate
      // fired — i.e. whenever a failed foundation drove the pillar down.
      let pillarCriticalGated = hasPillarGateFailure;
      if (!hasPillarGateFailure) {
        const hardCriticalFailures = pillarMetrics.filter(m =>
          m.criticality === 'critical' && m.applicable !== false && m.required !== false && !m.outOfScope &&
          ((m.zeroed_by_rules ? m.natural_score : m.score) === 0)
        );
        if (hardCriticalFailures.length > 0) {
          pillarCriticalGated = true;
          const cap = Math.round(pillarDef.maxPoints * PILLAR_CRIT_CAP_PCT * 100) / 100;
          if (pillarScore > cap) {
            const details = hardCriticalFailures.map(m =>
              m.scored ? `${m.display_name} (failed)` : `${m.display_name} (missing)`
            ).join(', ');
            allFindings.push({
              pillar: pillarId,
              category: pillarDef.name,
              severity: 'warning',
              source: 'engine',
              title: `${pillarDef.name} pillar capped at ${Math.round(PILLAR_CRIT_CAP_PCT * 100)}% — critical gate`,
              description: `A critical metric in this pillar hard-failed or is missing, capping the whole pillar at ${cap}/${pillarDef.maxPoints}. Triggered by: ${details}.`,
              remediation: 'Address the critical failure(s) to unlock full pillar scoring.',
            });
            pillarScore = cap;
          }
        }
      }

      const pillarPct = pillarMaxScore > 0 ? Math.round((pillarScore / pillarMaxScore) * 100) : 0;
      pillarRequired = round2(Math.min(pillarRequired, pillarScore));
      const pillarOnTarget = !hasPillarGateFailure && !pillarMetrics.some(missesRequired)
        && reachesTarget(pillarRequired, pillarTarget);
      const pillarAttainment = targetAttainment(pillarRequired, pillarTarget, pillarMaxScore, pillarPct, pillarOnTarget);

      pillars[pillarId] = {
        name: pillarDef.name,
        score: pillarScore,
        maxScore: pillarMaxScore,
        percentage: pillarPct,
        target: pillarTarget,
        requiredScore: pillarRequired,
        pointsNotAssessed: round2(pillarNotAssessed),
        targetAttainment: pillarAttainment,
        onTarget: pillarOnTarget,
        status: this._getTargetStatus(pillarAttainment, pillarOnTarget),
        metrics: pillarMetrics,
        findings: allFindings.filter(f => f.pillar === pillarId),
        ...(pillarCriticalGated ? { criticalGated: true } : {}),
      };

      totalScore += pillarScore;
    }

    totalScore = Math.round(totalScore * 100) / 100;
    const totalMaxScore = Object.values(pillars).reduce((sum, p) => sum + p.maxScore, 0);
    const totalPct = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;
    const totalTarget = round2(Object.values(pillars).reduce((sum, p) => sum + p.target, 0));
    const totalRequired = round2(Object.values(pillars).reduce((sum, p) => sum + p.requiredScore, 0));
    const totalNotAssessed = round2(Object.values(pillars).reduce((sum, p) => sum + p.pointsNotAssessed, 0));
    // "Target not reached" (DEC-029): the required checks the estate misses,
    // so every consumer flags the same thing.
    const requiredMissed = allMetrics.filter(missesRequired).map((m) => ({
      id: m.metric_id,
      name: m.display_name,
      pillar: m.pillar,
      subcategory: m.subcategory,
      reason: !m.scored ? 'missing' : m.zeroed_by_rules ? 'invalidated' : m.score > 0 ? 'partial' : 'failed',
      ...(m.outOfScope ? { outOfScope: true } : {}),
    }));
    // A pillar short of its target with no check missed lost its points to a
    // rule: list the rule once per section (or pillar, for a pillar deduction)
    // its deductions or caps touched there (a rule can act on two pillars), so
    // the flag always names a cause.
    const listed = new Set();
    for (const f of ruleFindings) {
      for (const mv of pointMoves(f)) {
        const sub = mv.type === 'pillar_deduction' ? null : mv.target;
        const pillarId = sub ? (this.catalog.getSubcategory(sub) || {}).pillar : mv.target;
        const p = pillars[pillarId];
        const key = `${f.rule_id}|${pillarId}|${sub}`;
        if (!p || p.onTarget || p.metrics.some(missesRequired) || listed.has(key)) continue;
        listed.add(key);
        requiredMissed.push({ id: f.rule_id, name: f.title, pillar: pillarId, subcategory: sub, reason: 'rule' });
      }
    }
    const totalOnTarget = requiredMissed.length === 0 && gateZeroedPillars.size === 0
      && Object.values(pillars).every((p) => p.onTarget);
    const totalAttainment = targetAttainment(totalRequired, totalTarget, totalMaxScore, totalPct, totalOnTarget);
    const recommendations = this._generateRecommendations(pillars, allFindings, allMetrics);

    // Subcategory rollup — expose the realised, post-gate/post-cap subcategory
    // scores the engine already computed in `subcategoryResults`. Additive:
    // existing consumers read `pillars`/`allMetrics`, never a closed key-set,
    // so an extra key is safe. This is the only source of the true subcategory
    // number once the 60% criticality gate, subcategory_cap/deduction rules AND
    // the pillar zero gate have been applied — per-metric scores alone cannot
    // reproduce it. A gate-zeroed pillar zeroes its subcategory entries too
    // (sparse `zeroedByPillarGate` flag), so sums always match the pillar.
    // pillar_deduction stays pillar-scoped by design: it is not attributable to
    // one subcategory, so after it a pillar may show less than its subs' sum.
    const subcategories = {};
    for (const [sid, r] of subcategoryResults) {
      const sub = this.catalog.getSubcategory(sid);
      const gated = gateZeroedPillars.has(sub.pillar);
      const score = gated ? 0 : r.score;
      const pct = !gated && r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0;
      const subOnTarget = !gated && !r.metrics.some(missesRequired)
        && reachesTarget(Math.min(r.requiredScore, r.score), r.target);
      const attained = gated ? 0 : targetAttainment(Math.min(r.requiredScore, r.score), r.target, r.maxScore, pct, subOnTarget);
      subcategories[sid] = {
        name: sub.name,
        pillar: sub.pillar,
        score,
        maxScore: r.maxScore,
        percentage: pct,
        target: r.target,
        pointsNotAssessed: r.pointsNotAssessed,
        targetAttainment: attained,
        onTarget: subOnTarget,
        status: this._getTargetStatus(attained, subOnTarget),
        hasCriticalFailure: r.hasCriticalFailure,
        ...(gated ? { zeroedByPillarGate: true } : {}),
      };
    }

    // Context echo (v1.11.0+): the assessment describes the conditions it was
    // scored under, so a stored/shared score is reproducible and citable.
    // Additive — no existing consumer reads a closed key-set.
    const context = {
      technology: this.catalog.technology,
      catalogVersion: this.catalog.version,
      engineVersion: ENGINE_VERSION,
      mode,
      workloadProfile,
      deploymentProfile,
      pgVersion,
      serverVersion: effectiveVersion,
      licensedOptions: [...ownedLicenses],
      availableSources,
      systemFactsProvided: Object.keys(systemFacts || {}),
      // Declarations (1.16.0): the targets this assessment was judged against,
      // one entry per catalog metric flagged declared_target, in the catalog's
      // spelling, null when not declared. Lets a consumer tell a raised bar
      // from a drifting estate.
      declarations: declarationsOf(this.catalog, values),
      // Fingerprints (1.16.0): same rules code means the same ruler, same
      // declarations code means the same declared targets, and since 1.17.0
      // the same target unless an applicability fact changed (a practice, a
      // guard on a collected value, a server version).
      fingerprint: fingerprints(this.catalog, values),
    };

    // Coverage (v1.11.0+): how much of the *applicable* catalog was actually
    // assessed. Weights are each metric's effective weight — for scored and
    // missing metrics that is the metric entry's `maxScore`; not-applicable and
    // license-excluded metrics carry maxScore 0 and sit outside the denominator
    // entirely. A missing critical still punishes the score AND lowers coverage
    // (both are true, both visible). Lets a sparse assessment read as sparse
    // rather than silently out-scoring a fully-collected one.
    let assessedWeight = 0;
    let applicableWeight = 0;
    const covCounts = {
      scored: 0, missingCritical: 0, missingNonCritical: 0,
      notApplicable: 0, licenseExcluded: 0,
    };
    const perPillarWeights = {};
    for (const m of allMetrics) {
      const pid = m.pillar;
      if (!perPillarWeights[pid]) perPillarWeights[pid] = { assessed: 0, applicable: 0 };
      // Out-of-scope checks stay outside the coverage denominator (1.15.0
      // semantics, reported by collectionScope); pointsNotAssessed counts them.
      if (m.outOfScope) continue;
      if (m.applicable === false) {
        if (m.exclusion_reason === 'license') covCounts.licenseExcluded++;
        else covCounts.notApplicable++;
        continue;
      }
      applicableWeight += m.maxScore;
      perPillarWeights[pid].applicable += m.maxScore;
      if (m.scored) {
        assessedWeight += m.maxScore;
        perPillarWeights[pid].assessed += m.maxScore;
        covCounts.scored++;
      } else if (m.criticality === 'critical') {
        covCounts.missingCritical++;
      } else {
        covCounts.missingNonCritical++;
      }
    }
    const perPillar = {};
    for (const [pid, w] of Object.entries(perPillarWeights)) {
      perPillar[pid] = w.applicable > 0 ? Math.round((w.assessed / w.applicable) * 100) : 0;
    }
    // Collection scope (1.15.0, adoption review): metrics that apply to the
    // estate but were never in scope because the run did not declare their
    // evidence source (or ran standalone without the agent). They sit outside
    // the coverage denominator, so a SQL-only run can read 100 percent; the
    // scope label says the assessment was partial. License-excluded metrics
    // are not counted: they do not apply. An applies_when predicate only
    // removes a metric when every metric it reads has a value: a predicate
    // over a value that was never collected is unknown, not false (L-006).
    const outOfScope = scopeExcluded.filter((m) => {
      const req = m.license_requirement;
      if (req && !ownedLicenses.has(String(req).toLowerCase())) return false;
      if (!m.applies_when) return true;
      const read = predicateMetrics(m.applies_when);
      const known = read.every((name) => values[name] !== undefined && values[name] !== null && values[name] !== '');
      return !known || evaluatePredicate(m.applies_when, values, evalCtx);
    });
    const scopeReason = (m) => this.catalog.getExclusionReason(m, filterOptions);

    const coverage = {
      collectionScope: outOfScope.length > 0 ? 'partial' : 'full',
      outOfScope: {
        count: outOfScope.length,
        critical: outOfScope.filter((m) => m.criticality === 'critical').map((m) => m.metric_id),
        metricIds: outOfScope.map((m) => m.metric_id),
        // mode: agent-only metrics in a standalone run; source: an evidence
        // source this run did not declare in availableSources.
        byReason: {
          mode: outOfScope.filter((m) => scopeReason(m) === 'mode').length,
          source: outOfScope.filter((m) => scopeReason(m) === 'source').length,
        },
      },
      assessedWeight: Math.round(assessedWeight * 100) / 100,
      applicableWeight: Math.round(applicableWeight * 100) / 100,
      percentage: applicableWeight > 0 ? Math.round((assessedWeight / applicableWeight) * 100) : 0,
      counts: covCounts,
      perPillar,
    };

    // Disposition (1.15.0, adoption review): an unresolved critical problem is
    // reported in its own field, never only through the numeric band. A pillar
    // held at the critical cap can still leave the total "excellent", and a
    // critical cross-metric finding may not move the band at all. Additive:
    // score and status are unchanged.
    // One item per problem: a critical rule that invalidates a critical metric
    // is one item (the rule, listing the metric under `invalidates`), not two.
    const ruleItems = new Map();
    for (const f of allFindings) {
      if (f.kind === 'consistency' && f.severity === 'critical' && !ruleItems.has(f.rule_id)) {
        ruleItems.set(f.rule_id, { kind: 'rule', id: f.rule_id, name: f.title, pillar: f.pillar, reason: 'rule', invalidates: [] });
      }
    }
    const metricItems = [];
    for (const m of allMetrics) {
      // Out-of-scope criticals are reported in `unassessed`, not as items.
      if (m.criticality !== 'critical' || m.applicable === false || m.required === false || m.outOfScope) continue;
      const base = { kind: 'metric', id: m.metric_id, name: m.display_name, pillar: m.pillar };
      const rules = m.zeroed_by_rules ? { rules: m.zeroed_by_rules } : {};
      if (!m.scored) {
        metricItems.push({ ...base, reason: 'missing' });
      } else if (m.unresolved) {
        metricItems.push({ ...base, reason: 'unresolved', ...rules });
      } else if ((m.zeroed_by_rules ? m.natural_score : m.score) < m.maxScore) {
        metricItems.push({ ...base, reason: 'failed', ...rules });
      } else if (m.zeroed_by_rules) {
        if (m.zeroed_by_rules.every((id) => ruleItems.has(id))) {
          for (const id of m.zeroed_by_rules) ruleItems.get(id).invalidates.push(m.metric_id);
        } else {
          metricItems.push({ ...base, reason: 'invalidated', ...rules });
        }
      }
    }
    const dispositionItems = [...metricItems, ...ruleItems.values()];
    const disposition = {
      state: dispositionItems.length > 0 ? 'critical_unresolved' : 'clear',
      items: dispositionItems,
      // Critical metrics never assessed because their collector did not run
      // (coverage.outOfScope), or because an unknown server version left them
      // out (1.17.0, reason version_unknown). "clear" covers assessed metrics
      // only; these are unknown, not passed. Only checks the targets require.
      unassessed: (() => {
        const required = (cm) => !(cm && cm.optional_when && evaluatePredicate(cm.optional_when, values, evalCtx));
        const list = outOfScope.filter((m) => m.criticality === 'critical' && required(m)).map((m) => ({
          id: m.metric_id, name: m.display_name, reason: scopeReason(m),
        }));
        for (const m of allMetrics) {
          if (m.criticality !== 'critical' || m.exclusion_reason !== 'version_unknown') continue;
          if (list.some((i) => i.id === m.metric_id) || !required(this.catalog.getByLegacyName(m.name))) continue;
          list.push({ id: m.metric_id, name: m.display_name, reason: 'version_unknown' });
        }
        return list;
      })(),
    };

    return {
      totalScore,
      totalMaxScore,
      totalPercentage: totalPct,
      targetScore: totalTarget,
      requiredScore: totalRequired,
      pointsNotAssessed: totalNotAssessed,
      targetAttainment: totalAttainment,
      onTarget: totalOnTarget,
      requiredMissed,
      status: this._getTargetStatus(totalAttainment, totalOnTarget),
      disposition,
      context,
      coverage,
      pillars,
      subcategories,
      licenseExcluded,
      allMetrics,
      allFindings,
      recommendations,
    };
  }

  /**
   * Score a single subcategory.
   * Applies weighted normalization and criticality gates.
   * @private
   */
  _scoreSubcategory(subcatId, subcatDef, metrics, values, valueSources = {}, evalCtx = {}, ruleEffects = {}) {
    const notApplicable = ruleEffects.notApplicable || new Set();
    const metricZeroes = ruleEffects.metricZeroes || new Map();
    const licenseExcludedSet = ruleEffects.licenseExcludedSet || new Set();
    const optional = ruleEffects.optional || new Map();
    const outOfScopeSet = ruleEffects.outOfScopeSet || new Set();
    const versionUnknown = ruleEffects.versionUnknown || new Set();
    const maxPoints = subcatDef.maxPoints;
    const scoredMetrics = [];
    const findings = [];
    let hasCriticalFailure = false;
    let totalWeight = 0;
    let requiredWeight = 0;
    let weightedScore = 0;
    let requiredWeightedScore = 0;
    let zeroedNaturalSum = 0;
    let notAssessedWeight = 0;
    const zeroedEntries = [];

    for (const metric of metrics) {
      const value = values[metric.legacy_name];
      const weight = this.catalog.getEffectiveWeight(metric);

      // Not applicable (applies_when=false, v1.8.0+): reported for audit but
      // excluded from numerator, denominator, and gates. Distinct from "not
      // provided": no points were at stake (maxScore: 0), no findings.
      if (notApplicable.has(metric.legacy_name)) {
        scoredMetrics.push({
          name: metric.legacy_name,
          metric_id: metric.metric_id,
          display_name: metric.display_name,
          value: (value === undefined || value === null || value === '')
            ? (versionUnknown.has(metric.legacy_name) ? 'version unknown' : 'not applicable') : value,
          source: metric.sources[0],
          description: metric.description,
          scored: false,
          applicable: false,
          score: 0,
          maxScore: 0,
          criticality: metric.criticality,
          subcategory: subcatId,
          exclusion_reason: licenseExcludedSet.has(metric.legacy_name) ? 'license'
            : versionUnknown.has(metric.legacy_name) ? 'version_unknown' : 'applies_when',
          ...(licenseExcludedSet.has(metric.legacy_name) ? { license_requirement: metric.license_requirement } : {}),
        });
        continue;
      }

      // Not required by the declared targets (1.16.0): counts, never gates.
      const because = optional.get(metric.legacy_name);
      const requirement = because ? { required: false, optional_because: because } : { required: true };

      const outOfScope = outOfScopeSet.has(metric.legacy_name);
      if (outOfScope || value === undefined || value === null || value === '') {
        // Not collected (1.17.0): the check stays on the ruler at 0 points,
        // in the target when required, and counts as not assessed. A required
        // critical the run could have collected still triggers the gate; one
        // outside the run's collection scope never does (the run had no means
        // to collect it). A check the targets do not require leaves the target
        // and never gates. A non-critical declared target left blank costs
        // nothing (Adrien, 2026-10-08): it keeps its full points, as any
        // declared value would (the declaration itself is never graded), so
        // its section never empties and its neighbours never weigh more; an
        // undeclared estate already pays through a target at its maximum.
        const undeclared = metric.declared_target === true && metric.criticality !== 'critical';
        if (undeclared) {
          totalWeight += weight;
          weightedScore += weight;
          if (!because) {
            requiredWeight += weight;
            requiredWeightedScore += weight;
          }
        } else {
          totalWeight += weight;
          notAssessedWeight += weight;
          if (!because) {
            requiredWeight += weight;
            if (metric.criticality === 'critical' && !outOfScope) hasCriticalFailure = true;
          }
        }

        scoredMetrics.push({
          name: metric.legacy_name,
          metric_id: metric.metric_id,
          display_name: metric.display_name,
          value: undeclared ? 'not declared' : outOfScope ? 'not in scope' : 'not provided',
          source: metric.sources[0],
          description: metric.description,
          scored: false,
          score: undeclared ? weight : 0,
          maxScore: weight,
          criticality: metric.criticality,
          subcategory: subcatId,
          ...(outOfScope ? { outOfScope: true } : {}),
          ...(undeclared ? { undeclared: true } : {}),
          ...requirement,
        });

        if (!outOfScope && metric.sources.includes('manual')) {
          findings.push({
            pillar: subcatDef.pillar,
            category: 'Manual Input',
            severity: 'info',
            source: 'manual',
            title: `${metric.display_name} — not provided`,
            description: `No value provided for ${metric.legacy_name}.`,
            remediation: 'Provide this value in the Manual Inputs section.',
          });
        }
        continue;
      }

      totalWeight += weight;
      if (!because) requiredWeight += weight;
      const evalResult = evaluateMetric(metric, value, weight, evalCtx);
      const { score: naturalScore, passed: naturalPassed, unresolved, fallback, derivation } = evalResult;

      // metric_zero (v1.8.0+): a fired rule invalidates this metric's points.
      // The awarded score becomes 0 but the weight stays in the denominator
      // (punitive — unlike not-applicable). Gates keep following the NATURAL
      // evaluation: a zeroed-but-naturally-passing critical does not fire the
      // 60% gate (compose an explicit subcategory_cap in the rule if wanted).
      const zeroAdjs = metricZeroes.get(metric.legacy_name);
      const isZeroed = Array.isArray(zeroAdjs) && zeroAdjs.length > 0;
      const awardedScore = isZeroed ? 0 : naturalScore;
      weightedScore += awardedScore;
      if (!because) requiredWeightedScore += awardedScore;

      if (metric.criticality === 'critical' && !naturalPassed && !because) {
        hasCriticalFailure = true;
      }

      const entry = {
        name: metric.legacy_name,
        metric_id: metric.metric_id,
        display_name: metric.display_name,
        value,
        source: valueSources[metric.legacy_name] || metric.sources[0],
        description: metric.description,
        scored: true,
        score: awardedScore,
        maxScore: weight,
        criticality: metric.criticality,
        subcategory: subcatId,
        derivation: derivation || undefined,
        ...(unresolved ? { unresolved: true } : {}),
        ...requirement,
      };
      if (isZeroed) {
        entry.zeroed_by_rules = zeroAdjs.map(a => a.rule_id);
        entry.natural_score = naturalScore;
        zeroedNaturalSum += naturalScore;
        zeroedEntries.push({ adjs: zeroAdjs, naturalScore, weight, name: metric.legacy_name });
      }
      scoredMetrics.push(entry);

      // Size-relative threshold could not be resolved (no systemFact, no fallback).
      // Surface as an info finding so reviewers know the metric was skipped.
      if (unresolved) {
        findings.push({
          pillar: subcatDef.pillar,
          category: subcatDef.name,
          severity: 'info',
          source: 'engine',
          title: `${metric.display_name} — relative threshold unresolved`,
          description: `Metric ${metric.legacy_name} requires a systemFact (e.g., ram_kb) for size-relative scoring, and no absolute fallback is configured.`,
          remediation: 'Provide the required systemFact (e.g., systemFacts.ram_kb) or add an absolute_floor to the metric.',
        });
      } else if (fallback) {
        findings.push({
          pillar: subcatDef.pillar,
          category: subcatDef.name,
          severity: 'info',
          source: 'engine',
          title: `${metric.display_name} — using absolute fallback`,
          description: `Metric ${metric.legacy_name} fell back to its absolute_floor because the required systemFact was not provided.`,
          remediation: 'Provide the required systemFact for accurate size-relative scoring.',
        });
      }

      if (!naturalPassed && metric.remediation) {
        // A failed check the targets do not require is an improvement above
        // the target: information severity, flagged so consumers can list it
        // after the required work.
        const severity = because ? 'info'
          : metric.criticality === 'critical' ? 'critical'
            : metric.criticality === 'important' ? 'warning' : 'info';
        findings.push({
          pillar: subcatDef.pillar,
          category: subcatDef.name,
          severity,
          source: valueSources[metric.legacy_name] || metric.sources[0] || 'sql',
          title: `${metric.display_name}`,
          description: metric.description,
          remediation: metric.remediation,
          ...(because ? { aboveTarget: true, metric: metric.legacy_name } : {}),
        });
      }
    }

    // Normalize weighted score to subcategory maxPoints
    let normalizedScore = 0;
    if (totalWeight > 0) {
      normalizedScore = (weightedScore / totalWeight) * maxPoints;
    }

    // Apply criticality gate: cap at 60% if any critical metric failed.
    // Always emit a finding when the gate is active, even when no actual
    // capping occurs (raw score already below cap) — otherwise a reviewer
    // sees a low score with no documented cause.
    if (hasCriticalFailure) {
      const cap = maxPoints * SUBCAT_GATE_CAP_PCT;
      const wasCapped = normalizedScore > cap;
      if (wasCapped) {
        normalizedScore = cap;
      }

      const criticalFailures = scoredMetrics.filter(m =>
        m.criticality === 'critical' && m.applicable !== false && m.required !== false && !m.outOfScope &&
        ((m.zeroed_by_rules ? m.natural_score : m.score) < m.maxScore)
      );
      const failureDetails = criticalFailures.map(m => {
        if (!m.scored) return `${m.display_name} (missing)`;
        if (m.score === 0) return `${m.display_name}=${m.value} (failed)`;
        return `${m.display_name}=${m.value} (partial credit ${m.score}/${m.maxScore})`;
      }).join(', ');

      findings.push({
        pillar: subcatDef.pillar,
        category: subcatDef.name,
        severity: 'warning',
        source: 'engine',
        title: wasCapped
          ? `${subcatDef.name} capped at ${Math.round(SUBCAT_GATE_CAP_PCT * 100)}% — critical gate`
          : `${subcatDef.name} — critical gate active (score already below ${Math.round(SUBCAT_GATE_CAP_PCT * 100)}%)`,
        description: wasCapped
          ? `A critical metric in this category failed, capping the subcategory score. Triggered by: ${failureDetails}.`
          : `A critical metric in this category failed. The subcategory score is already at or below the ${Math.round(SUBCAT_GATE_CAP_PCT * 100)}% cap, so no further capping was applied. Triggered by: ${failureDetails}.`,
        remediation: 'Address the critical metric failure(s) to unlock full scoring.',
      });
    }

    normalizedScore = Math.round(normalizedScore * 100) / 100;

    // Annotate metric_zero movements now that the realised subcategory score
    // is final. prior_score is the counterfactual: the same normalization
    // with the zeroed metrics' natural points restored (gate state is
    // identical by construction, since gates follow natural evaluation).
    if (zeroedEntries.length > 0) {
      let counterfactual = 0;
      if (totalWeight > 0) {
        counterfactual = ((weightedScore + zeroedNaturalSum) / totalWeight) * maxPoints;
      }
      if (hasCriticalFailure) {
        counterfactual = Math.min(counterfactual, maxPoints * SUBCAT_GATE_CAP_PCT);
      }
      counterfactual = Math.round(counterfactual * 100) / 100;
      for (const z of zeroedEntries) {
        for (const adj of z.adjs) {
          annotateMovement(adj, {
            type: 'metric_zero',
            target: z.name,
            subcategory: subcatId,
            metric_prior_score: z.naturalScore,
            metric_max: z.weight,
            applied: z.naturalScore,
            prior_score: counterfactual,
            new_score: normalizedScore,
          });
        }
      }
    }

    // A section drops out of the pillar maximum only when none of its checks
    // applies to the estate (1.17.0: an uncollected check keeps it in).
    const effectiveMaxScore = totalWeight > 0 ? maxPoints : 0;
    // Target (1.16.0, absolute since 1.17.0): the section's points times the
    // share of its weight the required checks carry, over every applicable
    // check whether collected or not.
    const target = totalWeight > 0 ? round2((requiredWeight / totalWeight) * maxPoints) : 0;
    const pointsNotAssessed = totalWeight > 0 ? round2((notAssessedWeight / totalWeight) * maxPoints) : 0;
    // Points earned on required checks, never above the realised score (the
    // gates and rule adjustments apply to them too).
    const requiredScore = totalWeight > 0
      ? round2(Math.min((requiredWeightedScore / totalWeight) * maxPoints, normalizedScore)) : 0;

    return {
      subcategory: subcatId,
      score: normalizedScore,
      maxScore: effectiveMaxScore,
      target,
      requiredScore,
      pointsNotAssessed,
      metrics: scoredMetrics,
      findings,
      hasCriticalFailure,
    };
  }

  /**
   * Compute derived-metric values and write them back into `values` under
   * each metric's legacy_name. Skip metrics whose formula returns `null`
   * (missing inputs) — the engine then treats them as not-provided.
   * @private
   */
  _computeDerivedMetrics(activeMetrics, values, systemFacts) {
    for (const metric of activeMetrics) {
      if (!metric.derived) continue;
      const formulaName = metric.derived_from && metric.derived_from.formula;
      if (!formulaName) continue;
      const handler = DERIVED_FORMULAS[formulaName];
      if (typeof handler !== 'function') continue;

      // Don't overwrite an explicit collector value if one was provided.
      if (values[metric.legacy_name] !== undefined && values[metric.legacy_name] !== null) {
        continue;
      }

      const inputs = (metric.derived_from && metric.derived_from.inputs) || [];
      const result = handler({ values, systemFacts }, inputs);
      if (result !== null && result !== undefined && !Number.isNaN(result)) {
        values[metric.legacy_name] = result;
      }
    }
  }

  /** @private */
  // Status thresholds — source of truth for both checker and platform.
  // Internal status codes are kept stable (excellent/good/needs_improvement/
  // critical) so existing CSS classes, filters, and badges don't break.
  // Downstream UI labels:
  //   excellent  ≥ 90  →  "Healthy"
  //   good       ≥ 70  →  "Degraded"
  //   needs_imp  ≥ 50  →  "Warning"
  //   critical   < 50  →  "Critical"
  /**
   * Status from the share of the target reached (DEC-029): "excellent" only
   * on target, i.e. every required check fully met; otherwise the bands apply
   * with "good" as the ceiling.
   * @private
   */
  _getTargetStatus(attainment, onTarget) {
    const status = this._getStatus(attainment);
    return status === 'excellent' && !onTarget ? 'good' : status;
  }

  _getStatus(pct) {
    if (pct >= STATUS_BANDS.excellent) return 'excellent';
    if (pct >= STATUS_BANDS.good) return 'good';
    if (pct >= STATUS_BANDS.needs_improvement) return 'needs_improvement';
    return 'critical';
  }

  /** @private */
  _generateRecommendations(pillars, findings, allMetrics) {
    const recommendations = [];

    const severityOrder = { critical: 0, warning: 1, info: 2, ok: 3 };
    const sorted = [...findings]
      .filter(f => f.severity !== 'ok' && f.severity !== 'info')
      .sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

    for (const f of sorted.slice(0, 15)) {
      if (f.remediation) {
        const relatedMetric = allMetrics.find(m => m.display_name === f.title || m.name === f.title);
        const effort = f.severity === 'critical' ? 'high' : f.severity === 'warning' ? 'medium' : 'low';
        recommendations.push({
          priority: f.severity === 'critical' ? 'high' : f.severity === 'warning' ? 'medium' : 'low',
          pillar: f.pillar,
          title: f.title,
          action: f.remediation,
          effort,
          potentialGain: relatedMetric ? relatedMetric.maxScore : null,
        });
      }
    }

    for (const [pillar, data] of Object.entries(pillars)) {
      if (data.targetAttainment < STATUS_BANDS.needs_improvement) {
        recommendations.push({
          priority: 'high',
          pillar,
          title: `${data.name} score is critically low (${data.targetAttainment}% of its target)`,
          action: `Review all ${data.name.toLowerCase()} metrics and address critical findings.`,
          effort: 'high',
        });
      }
    }

    // Checks the declared targets do not require, failed: improvements above
    // the target, listed after the required work (1.16.0).
    for (const f of findings.filter(x => x.aboveTarget && x.remediation)) {
      const relatedMetric = allMetrics.find(m => m.name === f.metric);
      recommendations.push({
        priority: 'low',
        pillar: f.pillar,
        title: f.title,
        action: f.remediation,
        effort: 'low',
        potentialGain: relatedMetric ? relatedMetric.maxScore : null,
        aboveTarget: true,
      });
    }

    return recommendations;
  }
}

// Names of the derived formulas the engine implements — asserted against the
// validation module's SUPPORTED_DERIVED_FORMULAS in tests to prevent drift.
ScoringEngine.DERIVED_FORMULA_NAMES = Object.keys(DERIVED_FORMULAS);

// Exposed for the policy test and the simulator (module shape unchanged).
ScoringEngine.DERIVED_FORMULAS = DERIVED_FORMULAS;

module.exports = ScoringEngine;
