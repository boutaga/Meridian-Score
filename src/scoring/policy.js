'use strict';

/**
 * Scoring policy (v1.15.0).
 *
 * The one place where the engine's shared, catalog-independent rules live:
 * criticality weights, the criticality gates, partial credit, the status
 * bands, engine defaults, the human-readable form of every derived formula,
 * and the vocabularies a catalog author must know. engine.js, evaluator.js
 * and constants.js read their numbers from here; scripts/generate-docs.js
 * renders the "Scoring policy" block of docs/scoring-model.md from here; the
 * simulator's "How the score works" page renders from here. Nothing in this
 * object is configurable at runtime: it is the published definition of the
 * score, frozen so that no consumer can mutate it.
 */

const v = require('../catalog/validation');

function deepFreeze(obj) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val);
  }
  return Object.freeze(obj);
}

const SCORING_POLICY = deepFreeze({
  version: '1.15.0',

  // Effective weight of a metric inside its subcategory pool.
  criticalityWeights: { critical: 3, important: 2, advisory: 1 },

  // A failed critical metric caps its subcategory at this share of the points.
  subcategoryGateCapPct: 0.6,

  // A hard-failed (natural score 0) or missing critical metric caps its whole
  // pillar at this share. Partial credit does not trigger it.
  pillarCriticalCapPct: 0.6,

  // threshold / range metrics: half the points when the value is within
  // `withinMultiple` of the bound (below min / withinMultiple, above
  // max * withinMultiple earns nothing).
  partialCredit: { factor: 0.5, withinMultiple: 2 },

  // Percentage floors of each status; below needs_improvement is 'critical'.
  statusBands: { excellent: 90, good: 70, needs_improvement: 50 },

  defaults: {
    // Restore rate assumed by restore_time_estimate_minutes when no restore
    // test attested a throughput: a conservative pgBackRest / barman / RMAN
    // restore on SSD.
    restoreThroughputMbPerSecond: 200,
  },

  // Human-readable form of every formula registered in engine.js
  // DERIVED_FORMULAS (test/policy.test.js keeps the two in sync).
  derivedFormulas: {
    memory_pressure_pct: {
      expression: '(shared_buffers_bytes + max_connections * work_mem_bytes) / ram_bytes * 100',
      inputs: ['shared_buffers_bytes', 'max_connections', 'work_mem_bytes', 'ram_bytes'],
      unit: 'percent',
      description: 'Configuration heuristic, not a bound: share of host RAM set aside for shared buffers plus max_connections times work_mem. work_mem applies per sort or hash operation and hash operations may use hash_mem_multiplier times it.',
    },
    wal_buffers_ratio: {
      expression: 'wal_buffers_bytes / shared_buffers_bytes',
      inputs: ['wal_buffers_bytes', 'shared_buffers_bytes'],
      unit: 'ratio',
      description: 'WAL buffers as a decimal share of shared buffers (0.03 = 3 percent).',
    },
    wal_buffers_ratio_capped: {
      expression: 'wal_buffers_bytes / min(shared_buffers_bytes / 32, 16 MB)',
      inputs: ['wal_buffers_bytes', 'shared_buffers_bytes'],
      unit: 'ratio',
      description: 'WAL buffers against the PostgreSQL auto-tune expectation; 1.0 is exactly the auto-tuned value.',
    },
    count_csv: {
      expression: 'count of non-empty comma-separated entries in the input',
      inputs: ['<one comma-separated input>'],
      unit: 'count',
      description: 'Number of entries declared in a comma-separated setting (for example synchronous_standby_names).',
    },
    oracle_memory_pct_of_ram: {
      expression: '(sga_target + (pga_aggregate_limit or pga_aggregate_target)) / ram_bytes * 100',
      inputs: ['sga_target', 'pga_aggregate_target', 'pga_aggregate_limit', 'ram_bytes'],
      unit: 'percent',
      description: 'Instance memory as a share of host RAM; the PGA hard limit is used when set, the target otherwise.',
    },
    restore_time_estimate_minutes: {
      expression: 'database_size_gb * 1024 / (restore_throughput_mb_s or defaults.restoreThroughputMbPerSecond) / 60',
      inputs: ['database_size', 'restore_throughput_mb_s'],
      unit: 'minutes',
      description: 'Minutes to restore the database at the attested restore throughput, or at the policy default when none was attested.',
    },
  },

  // Vocabularies enforced by the catalog validator (single source: validation.js).
  vocabularies: {
    sources: [...v.RECOGNIZED_SOURCES],
    anchors: [...v.RECOGNIZED_ANCHORS],
    stringFacts: [...v.RECOGNIZED_STRING_FACTS],
    profiles: [...v.RECOGNIZED_PROFILES],
    licenseRequirements: [...v.RECOGNIZED_LICENSE_REQUIREMENTS],
    booleanChecks: [...v.RECOGNIZED_BOOLEAN_CHECKS],
    predicateOperators: {
      metric: [...v.METRIC_LEAF_OPS],
      systemFact: [...v.NUMERIC_OPS],
      stringFact: [...v.STRING_FACT_OPS],
    },
    adjustmentTypes: [...v.VALID_ADJUSTMENT_TYPES],
    evaluationTypes: [...v.VALID_EVAL_TYPES],
    criticalities: [...v.VALID_CRITICALITY],
    ruleSeverities: [...v.VALID_RULE_SEVERITY],
  },
});

module.exports = { SCORING_POLICY };
