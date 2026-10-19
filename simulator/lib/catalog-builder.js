'use strict';

/**
 * Catalog mutation + validation helpers shared between routes
 * (impact analyzer, rules editor).
 *
 * buildModifiedCatalog is the canonical entry point: deep-clones a catalog,
 * applies declarative changes, and runs structural validation. Both export
 * paths and the compare endpoint reuse it.
 *
 * Validation delegates to the shared module src/catalog/validation.js —
 * the exact same walkers and whitelists the CI gate
 * (scripts/validate-catalogs.js) runs, so the simulator can no longer
 * green-light a catalog the CI would reject.
 */

const { validateCatalogData: validateCatalog } = require('../../src/catalog/validation');

/**
 * Build a modified catalog from changes applied to the original.
 *
 * @param {Object} originalCat   - MetricCatalog instance
 * @param {Object} changes       - { subcategoryPoints, metricCriticality, disabledMetrics, newMetrics, upsertedRules, deletedRules }
 * @param {Object} [sampleValues]- Optional sample values to merge new metric values into
 * @returns {{ modifiedData: Object, validation: Object, values: Object }}
 */
function buildModifiedCatalog(originalCat, changes = {}, sampleValues = {}) {
  const values = { ...sampleValues };

  // Deep clone original catalog data
  const modifiedData = {
    version: originalCat.version,
    maturity: originalCat.maturity || undefined,
    technology: originalCat.technology,
    pillars: JSON.parse(JSON.stringify(originalCat.pillars)),
    subcategories: JSON.parse(JSON.stringify(originalCat.subcategories)),
    metrics: JSON.parse(JSON.stringify(originalCat.metrics)),
    consistency_rules: JSON.parse(JSON.stringify(originalCat.getConsistencyRules() || [])),
  };

  // Apply subcategory point changes
  const pointChanges = changes.subcategoryPoints || {};
  for (const [subcatId, newPoints] of Object.entries(pointChanges)) {
    if (modifiedData.subcategories[subcatId]) {
      modifiedData.subcategories[subcatId].maxPoints = parseFloat(newPoints);
    }
  }

  // Apply metric criticality changes
  const critChanges = changes.metricCriticality || {};
  for (const [metricId, newCrit] of Object.entries(critChanges)) {
    const metric = modifiedData.metrics.find(m => m.metric_id === metricId);
    if (metric) metric.criticality = newCrit;
  }

  // Apply flat threshold edits (Simulator 2.0): shallow-merge into evaluation_config
  // Only flat shapes are editable (DEC-004): profile-keyed, size-relative,
  // declaration-keyed and derived metrics are ignored server-side too. A null
  // value removes the bound (a cleared input).
  const ecChanges = changes.evaluationConfigChanges || {};
  const isFlat = (m) => !m.derived && !(m.evaluation_config && (m.evaluation_config.profiles || m.evaluation_config.by_declaration || m.evaluation_config.min_pct !== undefined || m.evaluation_config.max_pct !== undefined));
  for (const [metricId, partial] of Object.entries(ecChanges)) {
    const metric = modifiedData.metrics.find(m => m.metric_id === metricId);
    if (!metric || !partial || typeof partial !== 'object' || !isFlat(metric)) continue;
    const merged = { ...(metric.evaluation_config || {}) };
    for (const [k, v] of Object.entries(partial)) {
      if (v === null) delete merged[k]; else merged[k] = v;
    }
    metric.evaluation_config = merged;
  }

  // Remove disabled metrics
  const disabledMetrics = changes.disabledMetrics || [];
  if (disabledMetrics.length > 0) {
    modifiedData.metrics = modifiedData.metrics.filter(m => !disabledMetrics.includes(m.metric_id));
  }

  // Add new metrics
  const newMetrics = changes.newMetrics || [];
  for (const nm of newMetrics) {
    if (!nm.metric_id || !nm.subcategory || !nm.legacy_name) continue;
    if (!modifiedData.subcategories[nm.subcategory]) continue;

    modifiedData.metrics.push({
      metric_id: nm.metric_id,
      subcategory: nm.subcategory,
      legacy_name: nm.legacy_name,
      display_name: nm.display_name || nm.legacy_name,
      description: nm.description || '',
      criticality: nm.criticality || 'advisory',
      weight: null,
      evaluation_type: nm.evaluation_type || 'boolean',
      evaluation_config: nm.evaluation_config || { pass_value: true },
      sources: nm.sources || ['sql'],
      agent_only: false,
      deployment_profiles: null,
      min_pg_version: null,
      extension_requirement: null,
      metric_tier: 'baseline',
      remediation: nm.remediation || '',
      cis_reference: null,
      gate_scope: null,
      applies_when: null,
      license_requirement: nm.license_requirement || null,
    });

    if (nm.sampleValue !== undefined && nm.sampleValue !== '') {
      let val = nm.sampleValue;
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(val) && val !== '') val = parseFloat(val);
      values[nm.legacy_name] = val;
    }
  }

  // Apply consistency rule changes
  const deletedRules = changes.deletedRules || [];
  if (deletedRules.length > 0) {
    modifiedData.consistency_rules = modifiedData.consistency_rules.filter(
      r => !deletedRules.includes(r.rule_id)
    );
  }
  const upsertedRules = changes.upsertedRules || [];
  for (const rule of upsertedRules) {
    if (!rule || !rule.rule_id) continue;
    const idx = modifiedData.consistency_rules.findIndex(r => r.rule_id === rule.rule_id);
    if (idx >= 0) modifiedData.consistency_rules[idx] = rule;
    else modifiedData.consistency_rules.push(rule);
  }

  const validation = validateCatalog(modifiedData);
  return { modifiedData, validation, values };
}

module.exports = { buildModifiedCatalog, validateCatalog };
