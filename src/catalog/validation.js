'use strict';

/**
 * Shared catalog-validation primitives (v1.8.0+).
 *
 * Single source of truth for the vocabulary whitelists and the structural
 * walkers used by BOTH validation consumers:
 *   - scripts/validate-catalogs.js   (CI gate)
 *   - simulator/lib/catalog-builder  (pre-export validation in the web UI)
 *
 * Design constraints:
 *   - No requires on the engine/evaluator (pure constants + functions, so the
 *     evaluator can require THIS module for its whitelists without a cycle).
 *   - Every function pushes human-readable strings into a caller-supplied
 *     `errors` array; callers decide how to render or aggregate them.
 *   - Fail closed: unknown vocabulary (adjustment types, anchors, profiles,
 *     boolean checks, derived formulas) is always an error.
 */

const VALID_EVAL_TYPES = ['boolean', 'enum', 'threshold', 'range'];
const VALID_CRITICALITY = ['critical', 'important', 'advisory'];
const VALID_RULE_SEVERITY = ['critical', 'warning', 'info'];
// Catalog maturity (1.15.0): how far a catalog's judgments have been reviewed.
// draft: not reviewed; measurement-reviewed: technology leaders reviewed how
// values are collected; field-evaluated: scoring checked against real estates;
// stable: reviewed evidence for every scored judgment.
const VALID_MATURITY = ['draft', 'measurement-reviewed', 'field-evaluated', 'stable'];
const VALID_ADJUSTMENT_TYPES = [
  'subcategory_cap',
  'subcategory_deduction',
  'pillar_deduction',
  'metric_zero',
  'none',
];

// Numeric systemFacts anchors — usable in size-relative thresholds
// (*_pct_of), derived-formula inputs, and numeric system_fact predicates.
const RECOGNIZED_ANCHORS = new Set([
  'ram_kb',
  'ram_bytes',
  'cpu_count',
  'storage_size_kb',
  'storage_size_bytes',
]);

// String-valued systemFacts (v1.8.0+) — usable ONLY in system_fact predicate
// leaves with equals/in/not_in. Never valid as a *_pct_of anchor or a
// derived-formula input.
const RECOGNIZED_STRING_FACTS = new Set(['storage_type', 'edition']);

// License/pack options a metric's collection SQL may require (v1.9.0+). Optional
// single-string `license_requirement`. When the customer's owned set (engine
// `licensedOptions`, with `enterprise_edition` auto-derived from edition=enterprise)
// does not include it, the metric is not-applicable — excluded from scoring, no
// penalty, reported in `result.licenseExcluded`. Pure metadata: the checker also
// reads it to skip running unlicensed SQL. Technology-agnostic; Oracle-populated today.
const RECOGNIZED_LICENSE_REQUIREMENTS = new Set([
  'enterprise_edition',
  'diagnostic_pack',
  'tuning_pack',
  'advanced_security',
  'advanced_compression',
  'partitioning',
  'rac',
  'active_data_guard',
]);

const RECOGNIZED_PROFILES = new Set(['default', 'oltp', 'olap', 'mixed']);
const RECOGNIZED_SOURCES = new Set(['sql', 'manual', 'zabbix', 'worker']);

// Boolean `check` values implemented by the engine evaluator — anything else
// silently falls through to strict boolean comparison and must be rejected.
const RECOGNIZED_BOOLEAN_CHECKS = new Set(['not_empty_or_dummy', 'not_empty']);

const SUPPORTED_DERIVED_FORMULAS = new Set([
  'memory_pressure_pct',
  'wal_buffers_ratio',
  'wal_buffers_ratio_capped',
  'count_csv',
  'oracle_memory_pct_of_ram',
  'restore_time_estimate_minutes',
]);

const NUMERIC_OPS = ['equals', 'gt', 'gte', 'lt', 'lte'];
const STRING_FACT_OPS = ['equals', 'in', 'not_in'];
const METRIC_LEAF_OPS = ['equals', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_truthy', 'provided'];

/**
 * Build the reference lookups the walkers need, from either a MetricCatalog
 * instance (has getByLegacyName/getSubcategory/getPillar) or a raw catalog
 * data object ({ pillars, subcategories, metrics }).
 */
function buildLookups(catalogOrData) {
  const isInstance = typeof catalogOrData.getByLegacyName === 'function';
  const metrics = catalogOrData.metrics || [];
  const byLegacyName = new Map(metrics.map(m => [m.legacy_name, m]));

  return {
    legacyNames: new Set(metrics.map(m => m.legacy_name)),
    subcategoryIds: new Set(Object.keys(
      isInstance ? catalogOrData.subcategories : (catalogOrData.subcategories || {})
    )),
    pillarIds: new Set(Object.keys(
      isInstance ? catalogOrData.pillars : (catalogOrData.pillars || {})
    )),
    getMetricByLegacyName(name) {
      return byLegacyName.get(name) || null;
    },
  };
}

/**
 * Validate one predicate tree (rule applies_when OR metric applies_when).
 * Strict walker: exactly-one operator per leaf, no composite/leaf mixing,
 * whitelisted anchors/profiles/string-facts, metric refs must exist.
 */
function validatePredicate(node, lookups, path, errors) {
  if (!node || typeof node !== 'object') {
    errors.push(`${path} is not an object`);
    return;
  }

  const composites = ['all_of', 'any_of', 'none_of'].filter(k => Array.isArray(node[k]));
  const leafOps = METRIC_LEAF_OPS.filter(k => node[k] !== undefined);

  if (composites.length > 0) {
    if (composites.length > 1 || leafOps.length > 0 || node.metric || node.system_fact !== undefined || node.workload_profile !== undefined) {
      errors.push(`${path} mixes composite and leaf operators`);
    }
    for (const k of composites) {
      node[k].forEach((c, i) => validatePredicate(c, lookups, `${path}.${k}[${i}]`, errors));
    }
    return;
  }

  // system_fact leaf — numeric anchors take exactly one numeric operator;
  // string facts (v1.8.0+) take exactly one of equals/in/not_in.
  if (node.system_fact !== undefined) {
    if (node.metric || node.workload_profile !== undefined) {
      errors.push(`${path} leaf mixes system_fact with other operand types`);
      return;
    }
    const name = node.system_fact;
    if (RECOGNIZED_ANCHORS.has(name)) {
      const numOps = NUMERIC_OPS.filter(k => node[k] !== undefined);
      if (numOps.length !== 1) {
        errors.push(`${path} system_fact '${name}' is numeric and must carry exactly one numeric operator (got ${numOps.length}; allowed: ${NUMERIC_OPS.join(', ')})`);
      }
    } else if (RECOGNIZED_STRING_FACTS.has(name)) {
      const strOps = STRING_FACT_OPS.filter(k => node[k] !== undefined);
      const extraOps = NUMERIC_OPS.filter(k => !STRING_FACT_OPS.includes(k) && node[k] !== undefined);
      if (strOps.length !== 1 || extraOps.length > 0) {
        errors.push(`${path} system_fact '${name}' is a string fact and must carry exactly one of ${STRING_FACT_OPS.join('/')}`);
      }
    } else {
      errors.push(`${path} system_fact='${name}' is not recognized (numeric anchors: ${[...RECOGNIZED_ANCHORS].join(', ')}; string facts: ${[...RECOGNIZED_STRING_FACTS].join(', ')})`);
    }
    return;
  }

  // workload_profile leaf — string sugar OR { equals|in|not_in: … }.
  if (node.workload_profile !== undefined) {
    if (node.metric) {
      errors.push(`${path} leaf mixes workload_profile with other operand types`);
      return;
    }
    const spec = node.workload_profile;
    const probeValues = [];
    if (typeof spec === 'string') {
      probeValues.push(spec);
    } else if (spec && typeof spec === 'object') {
      const profileOps = STRING_FACT_OPS.filter(k => spec[k] !== undefined);
      if (profileOps.length !== 1) {
        errors.push(`${path} workload_profile object must carry exactly one of equals/in/not_in`);
        return;
      }
      if (spec.equals !== undefined) probeValues.push(spec.equals);
      if (Array.isArray(spec.in)) probeValues.push(...spec.in);
      if (Array.isArray(spec.not_in)) probeValues.push(...spec.not_in);
    } else {
      errors.push(`${path} workload_profile must be a string or { equals|in|not_in: … } object`);
      return;
    }
    for (const v of probeValues) {
      if (!RECOGNIZED_PROFILES.has(String(v).toLowerCase())) {
        errors.push(`${path} workload_profile value '${v}' is not a recognized profile (expected one of ${[...RECOGNIZED_PROFILES].join(', ')})`);
      }
    }
    return;
  }

  if (!node.metric) {
    errors.push(`${path} leaf missing metric/system_fact/workload_profile`);
    return;
  }
  if (leafOps.length !== 1) {
    errors.push(`${path} leaf must carry exactly one operator (got ${leafOps.length})`);
  }
  if (!lookups.legacyNames.has(node.metric)) {
    errors.push(`${path} references unknown metric '${node.metric}'`);
  }
}

/**
 * Validate one score-adjustment object.
 * `allowNone` distinguishes the singular form (where {type:'none'} is the
 * documented no-op) from entries inside the plural array (where it is not).
 */
function validateScoreAdjustment(sa, lookups, ruleId, errors, path = 'score_adjustment', allowNone = true) {
  if (!sa || typeof sa !== 'object') {
    errors.push(`${ruleId}: ${path} must be an object`);
    return;
  }
  if (!VALID_ADJUSTMENT_TYPES.includes(sa.type)) {
    errors.push(`${ruleId}: ${path}.type '${sa.type}' is invalid (expected one of ${VALID_ADJUSTMENT_TYPES.join(', ')})`);
    return;
  }
  if (sa.type === 'none') {
    if (!allowNone) errors.push(`${ruleId}: ${path} type 'none' is not allowed inside score_adjustments[]`);
    return;
  }
  if (sa.type === 'subcategory_cap' || sa.type === 'subcategory_deduction') {
    if (!sa.target || !lookups.subcategoryIds.has(sa.target)) {
      errors.push(`${ruleId}: ${path}.target='${sa.target}' is not a known subcategory id`);
    }
  }
  if (sa.type === 'pillar_deduction') {
    if (!sa.target || !lookups.pillarIds.has(sa.target)) {
      errors.push(`${ruleId}: ${path}.target='${sa.target}' is not a known pillar id`);
    }
  }
  if (sa.type === 'metric_zero') {
    if (!sa.target || !lookups.legacyNames.has(sa.target)) {
      errors.push(`${ruleId}: ${path}.target='${sa.target}' is not a known metric legacy_name`);
    }
  }
  if (sa.type === 'subcategory_cap' && (typeof sa.cap_pct !== 'number' || sa.cap_pct < 0 || sa.cap_pct > 100)) {
    errors.push(`${ruleId}: ${path}.cap_pct must be a number in [0,100]`);
  }
  if ((sa.type === 'subcategory_deduction' || sa.type === 'pillar_deduction')
    && (typeof sa.points !== 'number' || sa.points < 0)) {
    errors.push(`${ruleId}: ${path}.points must be a non-negative number`);
  }
}

/**
 * Validate a rule's adjustment block: singular `score_adjustment` XOR plural
 * `score_adjustments` (v1.8.0+, non-empty, no 'none', no duplicate
 * (type,target) pairs).
 */
function validateRuleAdjustments(ov, lookups, ruleId, errors) {
  const hasSingular = ov.score_adjustment !== undefined;
  const hasPlural = ov.score_adjustments !== undefined;

  if (hasSingular && hasPlural) {
    errors.push(`${ruleId}: carries both score_adjustment and score_adjustments — use exactly one form`);
    return;
  }
  if (hasPlural) {
    if (!Array.isArray(ov.score_adjustments) || ov.score_adjustments.length === 0) {
      errors.push(`${ruleId}: score_adjustments must be a non-empty array`);
      return;
    }
    const seen = new Set();
    ov.score_adjustments.forEach((sa, i) => {
      validateScoreAdjustment(sa, lookups, ruleId, errors, `score_adjustments[${i}]`, false);
      if (sa && typeof sa === 'object' && sa.type && sa.type !== 'none') {
        const key = `${sa.type}:${sa.target}`;
        if (seen.has(key)) {
          errors.push(`${ruleId}: duplicate adjustment (${key}) in score_adjustments`);
        }
        seen.add(key);
      }
    });
    return;
  }
  // Singular (or absent → treated as {type:'none'} by the engine).
  validateScoreAdjustment(ov.score_adjustment || { type: 'none' }, lookups, ruleId, errors);
}

/**
 * Validate one consistency rule (severity, predicate, adjustments, pillar_hint).
 * Duplicate-id tracking is the caller's job (it spans the rule list).
 */
function validateRule(rule, lookups, errors) {
  const ruleId = rule.rule_id;
  const ov = rule.on_violation || {};

  if (!VALID_RULE_SEVERITY.includes(ov.severity)) {
    errors.push(`${ruleId}: invalid severity ${ov.severity}`);
  }

  validateRuleAdjustments(ov, lookups, ruleId, errors);

  if (!rule.applies_when) {
    errors.push(`${ruleId}: missing applies_when`);
  } else {
    validatePredicate(rule.applies_when, lookups, `${ruleId}: applies_when`, errors);
  }

  if (rule.pillar_hint && !lookups.pillarIds.has(rule.pillar_hint)) {
    errors.push(`${ruleId}: unknown pillar_hint ${rule.pillar_hint}`);
  }
}

/**
 * Validate a threshold/range evaluation_config block (flat, profile-keyed,
 * or size-relative).
 */
function validateThresholdShape(metricId, ec, errors, path = 'evaluation_config') {
  if (!ec || typeof ec !== 'object') {
    errors.push(`${metricId}: ${path} missing or not an object`);
    return;
  }

  const hasFlat = ec.min !== undefined || ec.max !== undefined;
  const hasProfiles = ec.profiles && typeof ec.profiles === 'object';
  const hasRelative = ec.min_pct !== undefined || ec.max_pct !== undefined;
  const hasByDecl = ec.by_declaration && typeof ec.by_declaration === 'object';

  if (!hasFlat && !hasProfiles && !hasRelative && !hasByDecl) {
    errors.push(`${metricId}: ${path} missing min/max, profiles, *_pct, or by_declaration config`);
    return;
  }

  // Declaration-keyed thresholds (v1.14.0): validate the band shapes here; the
  // by_declaration.metric REFERENCE is validated by validateByDeclaration (it
  // needs lookups). A by_declaration metric MUST carry an undeclared fallback,
  // either a top-level flat min/max or a bands.default, so undeclared estates
  // still resolve to a bound. by_declaration and profiles are mutually exclusive.
  if (hasByDecl) {
    if (hasProfiles) {
      errors.push(`${metricId}: ${path} cannot combine by_declaration with profiles`);
    }
    const bands = ec.by_declaration.bands;
    if (!bands || typeof bands !== 'object' || Object.keys(bands).length === 0) {
      errors.push(`${metricId}: ${path}.by_declaration.bands must be a non-empty object`);
    } else {
      if (!hasFlat && bands.default === undefined) {
        errors.push(`${metricId}: ${path}.by_declaration needs an undeclared fallback (top-level min/max or a bands.default)`);
      }
      for (const [k, band] of Object.entries(bands)) {
        validateThresholdShape(metricId, band, errors, `${path}.by_declaration.bands.${k}`);
      }
    }
  }

  if (hasProfiles) {
    const profileKeys = Object.keys(ec.profiles);
    if (profileKeys.length === 0) {
      errors.push(`${metricId}: ${path}.profiles is empty`);
    }
    for (const [pName, pCfg] of Object.entries(ec.profiles)) {
      if (!RECOGNIZED_PROFILES.has(pName)) {
        errors.push(`${metricId}: ${path}.profiles.${pName} is not a recognized profile (expected one of ${[...RECOGNIZED_PROFILES].join(', ')})`);
      }
      validateThresholdShape(metricId, pCfg, errors, `${path}.profiles.${pName}`);
    }
  }

  if (ec.min_pct !== undefined) {
    if (!ec.min_pct_of) {
      errors.push(`${metricId}: ${path}.min_pct requires min_pct_of`);
    } else if (!RECOGNIZED_ANCHORS.has(ec.min_pct_of)) {
      errors.push(`${metricId}: ${path}.min_pct_of='${ec.min_pct_of}' is not a recognized anchor (expected one of ${[...RECOGNIZED_ANCHORS].join(', ')})`);
    }
    if (typeof ec.min_pct !== 'number' || ec.min_pct <= 0) {
      errors.push(`${metricId}: ${path}.min_pct must be a positive number`);
    }
  }
  if (ec.max_pct !== undefined) {
    if (!ec.max_pct_of) {
      errors.push(`${metricId}: ${path}.max_pct requires max_pct_of`);
    } else if (!RECOGNIZED_ANCHORS.has(ec.max_pct_of)) {
      errors.push(`${metricId}: ${path}.max_pct_of='${ec.max_pct_of}' is not a recognized anchor (expected one of ${[...RECOGNIZED_ANCHORS].join(', ')})`);
    }
    if (typeof ec.max_pct !== 'number' || ec.max_pct <= 0) {
      errors.push(`${metricId}: ${path}.max_pct must be a positive number`);
    }
  }
  if (ec.absolute_floor !== undefined) {
    if (typeof ec.absolute_floor !== 'object' || ec.absolute_floor === null) {
      errors.push(`${metricId}: ${path}.absolute_floor must be an object`);
    } else if (ec.absolute_floor.min === undefined && ec.absolute_floor.max === undefined) {
      errors.push(`${metricId}: ${path}.absolute_floor must define min or max`);
    }
  }
}

/**
 * Validate a metric's evaluation_config against its evaluation_type.
 */
function validateEvaluationConfig(metric, errors) {
  const ec = metric.evaluation_config || {};
  switch (metric.evaluation_type) {
    case 'boolean':
      if (ec.pass_value === undefined && !ec.check) {
        errors.push(`${metric.metric_id}: boolean metric missing pass_value or check in evaluation_config`);
      }
      if (ec.check !== undefined && !RECOGNIZED_BOOLEAN_CHECKS.has(ec.check)) {
        errors.push(`${metric.metric_id}: boolean check='${ec.check}' is not implemented by the engine (expected one of ${[...RECOGNIZED_BOOLEAN_CHECKS].join(', ')})`);
      }
      break;
    case 'enum':
      if (!Array.isArray(ec.pass_values) || ec.pass_values.length === 0) {
        errors.push(`${metric.metric_id}: enum metric missing non-empty pass_values in evaluation_config`);
      }
      break;
    case 'threshold':
    case 'range':
      validateThresholdShape(metric.metric_id, ec, errors);
      break;
  }
}

/**
 * Validate a derived metric's derived_from block. Inputs must resolve to a
 * metric legacy_name or a NUMERIC systemFacts anchor (string facts rejected).
 */
function validateDerivedFrom(metric, lookups, errors) {
  // The engine triggers on truthy `derived`, so validate any truthy value
  // and additionally insist on a clean boolean (alignment guard).
  if (!metric.derived) return;
  if (metric.derived !== true) {
    errors.push(`${metric.metric_id}: derived must be boolean true (got ${JSON.stringify(metric.derived)})`);
  }
  const df = metric.derived_from || {};
  if (!df.formula) {
    errors.push(`${metric.metric_id}: derived metric missing derived_from.formula`);
  } else if (!SUPPORTED_DERIVED_FORMULAS.has(df.formula)) {
    errors.push(`${metric.metric_id}: derived_from.formula='${df.formula}' is not supported (expected one of ${[...SUPPORTED_DERIVED_FORMULAS].join(', ')})`);
  }
  if (!Array.isArray(df.inputs) || df.inputs.length === 0) {
    errors.push(`${metric.metric_id}: derived metric must declare derived_from.inputs (non-empty array)`);
  } else {
    for (const inputName of df.inputs) {
      const known = lookups.legacyNames.has(inputName) || RECOGNIZED_ANCHORS.has(inputName);
      if (!known) {
        errors.push(`${metric.metric_id}: derived_from.inputs references unknown name '${inputName}' (must be a metric legacy_name or numeric systemFacts anchor)`);
      }
    }
  }
}

/** Metric legacy_names a predicate tree reads (metric leaves only). */
function predicateMetrics(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const key of ['all_of', 'any_of', 'none_of']) {
    if (Array.isArray(node[key])) node[key].forEach((child) => predicateMetrics(child, out));
  }
  if (typeof node.metric === 'string') out.push(node.metric);
  return out;
}

const isDeclaredTarget = (lookups, name) => {
  const m = lookups.getMetricByLegacyName(name);
  return !!m && m.declared_target === true;
};

/**
 * Validate a metric's own applies_when predicate (v1.8.0+). From 1.16.0 it
 * holds technical conditions only: a declared target never decides whether a
 * check is judged, it decides whether the check is required (optional_when).
 */
function validateMetricAppliesWhen(metric, lookups, errors) {
  if (metric.applies_when === undefined || metric.applies_when === null) return;
  validatePredicate(metric.applies_when, lookups, `${metric.metric_id}: applies_when`, errors);
  const declared = [...new Set(predicateMetrics(metric.applies_when))].filter((n) => isDeclaredTarget(lookups, n));
  if (declared.length > 0) {
    errors.push(`${metric.metric_id}: applies_when reads the declared target(s) ${declared.join(', ')}; a declaration never switches a check off, use optional_when`);
  }
}

/**
 * A floor check (1.16.0): `floor: true` marks a check no declaration may make
 * optional, whatever the technology (SSL/TLS is a floor on every environment,
 * DEC-025). When present it must be true.
 */
function validateFloor(metric, errors) {
  if (metric.floor === undefined || metric.floor === null) return;
  if (metric.floor !== true) errors.push(`${metric.metric_id}: floor must be true when present (got ${JSON.stringify(metric.floor)})`);
}

// Leaves and composites that can hold on an estate that declares nothing
// (none_of, not_in, provided:false): an undeclared estate must stay required.
function holdsWhenUndeclared(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node.none_of) || node.not_in !== undefined || node.provided === false) return true;
  return ['all_of', 'any_of'].some((k) => Array.isArray(node[k]) && node[k].some(holdsWhenUndeclared));
}

/**
 * Validate a metric's optional_when predicate (1.16.0). When it holds, the
 * check still counts but the declared targets do not require it: it leaves the
 * target score and never triggers a criticality gate. It may read declared
 * targets only, only through positive conditions (a missing declaration must
 * leave the check required), and may not sit on a floor check, a pillar-gate
 * check or a declaration itself.
 */
function validateOptionalWhen(metric, lookups, errors) {
  const ow = metric.optional_when;
  if (ow === undefined || ow === null) return;
  const path = `${metric.metric_id}: optional_when`;
  validatePredicate(ow, lookups, path, errors);
  const read = predicateMetrics(ow);
  if (read.length === 0) errors.push(`${path} reads no declared target`);
  const other = [...new Set(read)].filter((n) => !isDeclaredTarget(lookups, n));
  if (other.length > 0) errors.push(`${path} may read declared targets only (reads ${other.join(', ')})`);
  if (JSON.stringify(ow).match(/"(system_fact|workload_profile)"/)) {
    errors.push(`${path} may read declared targets only (no system_fact or workload_profile leaf)`);
  }
  if (holdsWhenUndeclared(ow)) errors.push(`${path} must not hold when nothing is declared (no none_of, not_in or provided:false)`);
  if (metric.floor === true) errors.push(`${path} is not allowed on a floor check`);
  if (metric.gate_scope === 'pillar') errors.push(`${path} is not allowed on a pillar-gate check`);
  if (metric.declared_target === true) errors.push(`${path} is not allowed on a declared target`);
}

/**
 * Validate a metric's by_declaration.metric reference (v1.14.0). The target
 * must be a known legacy_name (typically a declared-target enum such as
 * rpo_target). Band shapes are validated structurally by validateThresholdShape.
 */
function validateByDeclaration(metric, lookups, errors) {
  const ec = metric.evaluation_config || {};
  const bd = ec.by_declaration;
  if (!bd || typeof bd !== 'object') return;
  if (!bd.metric || !lookups.legacyNames.has(bd.metric)) {
    errors.push(`${metric.metric_id}: by_declaration.metric='${bd.metric}' is not a known metric legacy_name`);
  }
  // Optional unless predicate (1.15.0): same strict walker as applies_when.
  if (bd.unless !== undefined) {
    validatePredicate(bd.unless, lookups, `${metric.metric_id}.evaluation_config.by_declaration.unless`, errors);
  }
}

/**
 * Validate a metric's gate_scope (v1.14.0 hardening, June A6 footnote). Optional;
 * when present it must be 'pillar' (the only scope the engine's pillar zero gate
 * recognizes). Any other value would silently never fire. Fail closed.
 */
function validateGateScope(metric, errors) {
  const gs = metric.gate_scope;
  if (gs === undefined || gs === null) return;
  if (gs !== 'pillar') {
    errors.push(`${metric.metric_id}: gate_scope=${JSON.stringify(gs)} is not recognized (only 'pillar' is supported)`);
  }
}

/**
 * Validate a per-metric weight override (v1.8.0+). `weight` is optional; null
 * or absent means the criticality-derived default weight applies. When present
 * it must be a finite number greater than 0 — it scales the metric's share of
 * its subcategory denominator (e.g. 0.5 de-pads an always-pass capture metric).
 */
function validateWeight(metric, errors) {
  const w = metric.weight;
  if (w === undefined || w === null) return;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) {
    errors.push(`${metric.metric_id}: weight override must be a finite number > 0 (got ${JSON.stringify(w)})`);
  }
}

/**
 * Validate a per-metric license_requirement (v1.9.0+). Optional single string;
 * when present it must be one of RECOGNIZED_LICENSE_REQUIREMENTS. Fail closed.
 */
function validateLicenseRequirement(metric, errors) {
  const lr = metric.license_requirement;
  if (lr === undefined || lr === null) return;
  if (typeof lr !== 'string' || !RECOGNIZED_LICENSE_REQUIREMENTS.has(lr)) {
    errors.push(`${metric.metric_id}: license_requirement=${JSON.stringify(lr)} is not recognized (expected one of ${[...RECOGNIZED_LICENSE_REQUIREMENTS].join(', ')})`);
  }
}

/**
 * technical_anchor (v1.15.0): optional per-metric { summary, query }. When
 * present both are required non-empty strings. Soft length caps land in
 * `warnings` when a warnings array is supplied (summary 280, query 4000).
 */
const TECHNICAL_ANCHOR_SUMMARY_MAX = 280;
const TECHNICAL_ANCHOR_QUERY_MAX = 4000;

function validateTechnicalAnchor(metric, errors, warnings = null) {
  const ta = metric.technical_anchor;
  if (ta === undefined || ta === null) return;
  if (typeof ta !== 'object' || Array.isArray(ta)) {
    errors.push(`${metric.metric_id}: technical_anchor must be an object { summary, query }`);
    return;
  }
  for (const key of ['summary', 'query']) {
    const v = ta[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      errors.push(`${metric.metric_id}: technical_anchor.${key} must be a non-empty string`);
    }
  }
  if (Array.isArray(warnings)) {
    if (typeof ta.summary === 'string' && ta.summary.length > TECHNICAL_ANCHOR_SUMMARY_MAX) {
      warnings.push(`${metric.metric_id}: technical_anchor.summary is ${ta.summary.length} chars (soft cap ${TECHNICAL_ANCHOR_SUMMARY_MAX})`);
    }
    if (typeof ta.query === 'string' && ta.query.length > TECHNICAL_ANCHOR_QUERY_MAX) {
      warnings.push(`${metric.metric_id}: technical_anchor.query is ${ta.query.length} chars (soft cap ${TECHNICAL_ANCHOR_QUERY_MAX})`);
    }
  }
}

/**
 * Flat bounds sanity (v1.15.0): a flat threshold or range whose min exceeds its
 * max can never pass. Profile-keyed and declaration-keyed shapes are checked by
 * validateThresholdShape; this guards the flat shape the simulator edits.
 */
function validateFlatBounds(metric, errors) {
  const ec = metric.evaluation_config || {};
  if (Number.isFinite(ec.min) && Number.isFinite(ec.max) && ec.min > ec.max) {
    errors.push(`${metric.metric_id}: evaluation_config.min (${ec.min}) is greater than max (${ec.max})`);
  }
}

/**
 * rationale (v1.15.0): optional per-metric string saying where the threshold
 * or criticality comes from (documentation, benchmark, field practice).
 */
function validateCatalogMaturity(catalogData, errors) {
  const m = catalogData.maturity;
  if (m === undefined || m === null) return;
  if (!VALID_MATURITY.includes(m)) {
    errors.push(`catalog maturity '${m}' (expected one of ${VALID_MATURITY.join(', ')})`);
  }
}

function validateRationale(metric, errors) {
  const r = metric.rationale;
  if (r === undefined || r === null) return;
  if (typeof r !== 'string' || r.trim().length === 0) {
    errors.push(`${metric.metric_id}: rationale must be a non-empty string when present`);
  }
}

/**
 * declared_target (1.16.0): optional per-metric flag marking a declaration, a
 * target the organization sets for itself (recovery point, recovery time,
 * security posture, topology). The engine echoes flagged values in
 * context.declarations. When present it must be true, and the metric must be a
 * manual enum: a declaration is typed in by a person from a fixed vocabulary.
 */
function validateDeclaredTarget(metric, errors) {
  const dt = metric.declared_target;
  if (dt === undefined || dt === null) return;
  if (dt !== true) {
    errors.push(`${metric.metric_id}: declared_target must be true when present (got ${JSON.stringify(dt)})`);
    return;
  }
  const manual = Array.isArray(metric.sources) && metric.sources.includes('manual');
  if (metric.evaluation_type !== 'enum' || !manual) {
    errors.push(`${metric.metric_id}: declared_target requires a manual enum metric`);
  }
}

/**
 * Validate a raw catalog data object (the simulator's export check and a
 * rules bundle import, 1.16.0). Idempotent; safe to call on an unmodified
 * catalog. The CI gate (scripts/validate-catalogs.js) runs the same walkers.
 */
function validateCatalogData(catData) {
  const validation = { valid: true, errors: [], warnings: [] };

  // Pillar maxPoints invariant: subcategory points sum to 20 per pillar
  const pillarSums = {};
  for (const sub of Object.values(catData.subcategories)) {
    pillarSums[sub.pillar] = (pillarSums[sub.pillar] || 0) + sub.maxPoints;
  }
  for (const [pillar, sum] of Object.entries(pillarSums)) {
    if (Math.abs(sum - 20) > 0.01) {
      validation.valid = false;
      validation.errors.push(`${pillar}: subcategory points sum to ${sum}, expected 20`);
    }
  }

  // No duplicate metric IDs
  const metricIds = catData.metrics.map(m => m.metric_id);
  const dupes = metricIds.filter((id, i) => metricIds.indexOf(id) !== i);
  if (dupes.length > 0) {
    validation.valid = false;
    validation.errors.push(`Duplicate metric IDs: ${[...new Set(dupes)].join(', ')}`);
  }

  // Per-metric + rule validation — exact CI-gate semantics via the shared
  // module (evaluation_config shapes, derived metrics, applies_when
  // predicates, rule predicates + singular/plural score adjustments).
  const lookups = buildLookups(catData);
  validateCatalogMaturity(catData, validation.errors);

  for (const m of catData.metrics) {
    validateEvaluationConfig(m, validation.errors);
    validateDerivedFrom(m, lookups, validation.errors);
    validateMetricAppliesWhen(m, lookups, validation.errors);
    validateOptionalWhen(m, lookups, validation.errors);
    validateFloor(m, validation.errors);
    validateByDeclaration(m, lookups, validation.errors);
    validateGateScope(m, validation.errors);
    validateWeight(m, validation.errors);
    validateLicenseRequirement(m, validation.errors);
    validateTechnicalAnchor(m, validation.errors, validation.warnings);
    validateRationale(m, validation.errors);
    validateDeclaredTarget(m, validation.errors);
    validateFlatBounds(m, validation.errors);
  }

  const ruleIds = new Set();
  for (const rule of catData.consistency_rules || []) {
    if (!rule.rule_id) {
      validation.errors.push('A consistency rule is missing rule_id');
      continue;
    }
    if (ruleIds.has(rule.rule_id)) {
      validation.errors.push(`Duplicate rule_id: ${rule.rule_id}`);
    }
    ruleIds.add(rule.rule_id);
    validateRule(rule, lookups, validation.errors);
  }

  validation.valid = validation.errors.length === 0;
  return validation;
}

module.exports = {
  VALID_EVAL_TYPES,
  VALID_CRITICALITY,
  VALID_MATURITY,
  VALID_RULE_SEVERITY,
  VALID_ADJUSTMENT_TYPES,
  RECOGNIZED_ANCHORS,
  RECOGNIZED_STRING_FACTS,
  RECOGNIZED_LICENSE_REQUIREMENTS,
  RECOGNIZED_PROFILES,
  RECOGNIZED_SOURCES,
  RECOGNIZED_BOOLEAN_CHECKS,
  SUPPORTED_DERIVED_FORMULAS,
  NUMERIC_OPS,
  STRING_FACT_OPS,
  METRIC_LEAF_OPS,
  buildLookups,
  validatePredicate,
  validateScoreAdjustment,
  validateRuleAdjustments,
  validateRule,
  validateThresholdShape,
  validateEvaluationConfig,
  validateDerivedFrom,
  validateMetricAppliesWhen,
  validateOptionalWhen,
  predicateMetrics,
  validateFloor,
  validateByDeclaration,
  validateGateScope,
  validateWeight,
  validateLicenseRequirement,
  validateTechnicalAnchor,
  validateRationale,
  validateDeclaredTarget,
  validateCatalogMaturity,
  validateFlatBounds,
  validateCatalogData,
  TECHNICAL_ANCHOR_SUMMARY_MAX,
  TECHNICAL_ANCHOR_QUERY_MAX,
};
