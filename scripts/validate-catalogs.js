'use strict';

/**
 * Validate structural integrity of all metric catalogs.
 *
 * Checks:
 * - 5 pillars, each with maxPoints=20
 * - Subcategory points sum to 20 per pillar
 * - No duplicate metric_ids or legacy_names
 * - Valid references (metric -> subcategory -> pillar)
 * - Valid evaluation types, criticality levels, sources, boolean checks
 * - Threshold shapes (flat / profile-keyed / size-relative)
 * - Derived metrics (formula whitelist, inputs resolve)
 * - Per-metric applies_when predicates (v1.8.0+)
 * - Consistency rules (predicate DSL, score adjustments singular/plural)
 *
 * The vocabulary whitelists and shape walkers live in the shared module
 * src/catalog/validation.js, which the simulator's pre-export validation
 * consumes too — one source of truth, no drift.
 *
 * Usage: node scripts/validate-catalogs.js
 */

const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../src');
const {
  VALID_EVAL_TYPES,
  VALID_CRITICALITY,
  RECOGNIZED_SOURCES,
  buildLookups,
  validateEvaluationConfig,
  validateDerivedFrom,
  validateMetricAppliesWhen,
  validateOptionalWhen,
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
  validateRule,
} = require('../src/catalog/validation');

let totalErrors = 0;

function validate(tech) {
  const errors = [];
  const warnings = [];
  const cat = getCatalog(tech);
  const lookups = buildLookups(cat);

  // Every shipped catalog states its maturity (1.15.0).
  if (!cat.maturity) errors.push('missing catalog maturity');
  validateCatalogMaturity(cat, errors);

  // 5 pillars
  const pillarIds = cat.getPillarIds();
  if (pillarIds.length !== 5) {
    errors.push(`Expected 5 pillars, got ${pillarIds.length}`);
  }

  for (const pillarId of pillarIds) {
    const pillar = cat.getPillar(pillarId);
    if (pillar.maxPoints !== 20) {
      errors.push(`Pillar ${pillarId}: maxPoints=${pillar.maxPoints}, expected 20`);
    }

    const subcatIds = cat.getSubcategoryIds(pillarId);
    const total = subcatIds.reduce((sum, id) => sum + cat.getSubcategory(id).maxPoints, 0);
    if (total !== 20) {
      errors.push(`Pillar ${pillarId}: subcategory points sum to ${total}, expected 20`);
    }
  }

  // Unique IDs + per-metric checks
  const metricIds = new Set();
  const legacyNames = new Set();
  for (const m of cat.metrics) {
    if (metricIds.has(m.metric_id)) errors.push(`Duplicate metric_id: ${m.metric_id}`);
    metricIds.add(m.metric_id);

    if (legacyNames.has(m.legacy_name)) errors.push(`Duplicate legacy_name: ${m.legacy_name}`);
    legacyNames.add(m.legacy_name);

    if (!cat.getSubcategory(m.subcategory)) {
      errors.push(`${m.metric_id}: unknown subcategory ${m.subcategory}`);
    }

    if (!VALID_EVAL_TYPES.includes(m.evaluation_type)) {
      errors.push(`${m.metric_id}: invalid evaluation_type ${m.evaluation_type}`);
    }

    if (!VALID_CRITICALITY.includes(m.criticality)) {
      errors.push(`${m.metric_id}: invalid criticality ${m.criticality}`);
    }

    if (!Array.isArray(m.sources) || m.sources.length === 0) {
      errors.push(`${m.metric_id}: missing sources`);
    } else {
      for (const s of m.sources) {
        if (!RECOGNIZED_SOURCES.has(s)) {
          errors.push(`${m.metric_id}: sources contains '${s}' (expected one of ${[...RECOGNIZED_SOURCES].join(', ')})`);
        }
      }
    }

    validateEvaluationConfig(m, errors);
    validateDerivedFrom(m, lookups, errors);
    validateMetricAppliesWhen(m, lookups, errors);
    validateOptionalWhen(m, lookups, errors);
    validateFloor(m, errors);
    validateByDeclaration(m, lookups, errors);
    validateGateScope(m, errors);
    validateWeight(m, errors);
    validateLicenseRequirement(m, errors);
    validateTechnicalAnchor(m, errors, warnings);
    validateRationale(m, errors);
    validateDeclaredTarget(m, errors);
    validateFlatBounds(m, errors);
  }

  // Consistency rules
  const rules = cat.getConsistencyRules ? cat.getConsistencyRules() : [];
  const seenRuleIds = new Set();
  for (const r of rules) {
    if (!r || !r.rule_id) {
      errors.push('rule missing rule_id');
      continue;
    }
    if (seenRuleIds.has(r.rule_id)) errors.push(`duplicate rule_id: ${r.rule_id}`);
    seenRuleIds.add(r.rule_id);
    validateRule(r, lookups, errors);
  }

  return { errors, warnings };
}

console.log('Validating metric catalogs...\n');

for (const tech of SUPPORTED_TECHNOLOGIES) {
  const { errors, warnings } = validate(tech);
  const cat = getCatalog(tech);
  if (errors.length === 0) {
    console.log(`  ${tech}: OK (${cat.metrics.length} metrics, v${cat.version})`);
    for (const w of warnings) console.log(`    ~ warning: ${w}`);
  } else {
    console.log(`  ${tech}: FAILED (${errors.length} errors)`);
    for (const w of warnings) console.log(`    ~ warning: ${w}`);
    for (const e of errors) {
      console.log(`    - ${e}`);
    }
    totalErrors += errors.length;
  }
}

console.log('');
if (totalErrors > 0) {
  console.log(`VALIDATION FAILED: ${totalErrors} error(s) found.`);
  process.exit(1);
} else {
  console.log('All catalogs valid.');
}
