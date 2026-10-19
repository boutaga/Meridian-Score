'use strict';

const express = require('express');
const router = express.Router();
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../../src');
const { buildModifiedCatalog } = require('../lib/catalog-builder');
const { describeCriteria } = require('../lib/criteria');
const { humanizePredicate } = require('../lib/graph-builder');
const { SCORING_POLICY } = require('../../src');

router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }

  const cat = getCatalog(tech);

  // Build filter options
  const pillars = cat.getPillarIds().map(id => ({ id, name: cat.getPillar(id).name }));
  const subcategories = Object.entries(cat.subcategories).map(([id, sub]) => ({
    id,
    name: sub.name,
    pillar: sub.pillar,
  }));
  const sources = [...new Set(cat.metrics.flatMap(m => m.sources))].sort();
  const evalTypes = [...new Set(cat.metrics.map(m => m.evaluation_type))].sort();

  // Apply filters
  const filter = {
    pillar: req.query.pillar || '',
    subcategory: req.query.subcategory || '',
    source: req.query.source || '',
    criticality: req.query.criticality || '',
    evalType: req.query.evalType || '',
    search: req.query.search || '',
  };

  let metrics = cat.metrics;

  if (filter.pillar) {
    metrics = metrics.filter(m => {
      const sub = cat.getSubcategory(m.subcategory);
      return sub && sub.pillar === filter.pillar;
    });
  }
  if (filter.subcategory) {
    metrics = metrics.filter(m => m.subcategory === filter.subcategory);
  }
  if (filter.source) {
    metrics = metrics.filter(m => m.sources.includes(filter.source));
  }
  if (filter.criticality) {
    metrics = metrics.filter(m => m.criticality === filter.criticality);
  }
  if (filter.evalType) {
    metrics = metrics.filter(m => m.evaluation_type === filter.evalType);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    metrics = metrics.filter(m =>
      m.metric_id.toLowerCase().includes(q) ||
      m.display_name.toLowerCase().includes(q) ||
      m.legacy_name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
    );
  }

  res.render('metrics', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    metrics,
    pillars,
    subcategories,
    sources,
    evalTypes,
    filter,
    catalog: cat,
    criteriaText: describeCriteria,
    activePage: 'metrics',
  });
});

// =============================================================================
// Cross-metric consistency rules — dedicated sub-page under /metrics
// =============================================================================

router.get('/:tech/rules', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }

  const cat = getCatalog(tech);
  const consistencyRules = cat.getConsistencyRules() || [];
  const legacyNames = cat.metrics.map(m => m.legacy_name).sort();
  const subcategoryIds = Object.keys(cat.subcategories);
  const pillarIds = cat.getPillarIds();
  const subcategoryLabels = Object.fromEntries(
    Object.entries(cat.subcategories).map(([id, s]) => [id, `${cat.getPillar(s.pillar).name} > ${s.name}`])
  );

  // Compact metric index for the guided rule builder (datalists + value suggestions).
  const metricsIndex = cat.metrics
    .map(m => ({
      legacy_name: m.legacy_name,
      display_name: m.display_name,
      subcategory: m.subcategory,
      evaluation_type: m.evaluation_type,
      evaluation_config: m.evaluation_config || {},
    }))
    .sort((a, b) => a.legacy_name.localeCompare(b.legacy_name));

  res.render('rules', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    catalog: cat,
    consistencyRules,
    legacyNames,
    metricsIndex,
    subcategoryIds,
    subcategoryLabels,
    pillarIds,
    activePage: 'rules',
  });
});

// Validate a proposed rule set without exporting.
router.post('/:tech/rules/validate', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }
  const { changes } = req.body;
  const originalCat = getCatalog(tech);
  const { modifiedData, validation } = buildModifiedCatalog(originalCat, {
    upsertedRules: (changes && changes.upsertedRules) || [],
    deletedRules: (changes && changes.deletedRules) || [],
  });
  res.json({
    validation,
    rules: modifiedData.consistency_rules,
    counts: {
      original: originalCat.getConsistencyRules().length,
      modified: modifiedData.consistency_rules.length,
      upserted: ((changes && changes.upsertedRules) || []).length,
      deleted: ((changes && changes.deletedRules) || []).length,
    },
  });
});

// Export the FULL catalog (metrics + rules) as a single JSON file —
// drop-in replacement for data/metrics/<tech>.json.
router.post('/:tech/rules/export-full', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }
  const { changes } = req.body;
  const originalCat = getCatalog(tech);
  const { modifiedData, validation } = buildModifiedCatalog(originalCat, {
    upsertedRules: (changes && changes.upsertedRules) || [],
    deletedRules: (changes && changes.deletedRules) || [],
  });
  if (!validation.valid) {
    return res.status(400).json({ error: 'Validation failed', validation });
  }
  modifiedData.version = modifiedData.version + '-rules';
  const filename = `${tech}-catalog-with-rules.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(modifiedData, null, 2) + '\n');
});

// Export RULES ONLY as a standalone JSON file — useful when sharing
// proposed rule sets without the full catalog payload.
router.post('/:tech/rules/export-rules', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }
  const { changes } = req.body;
  const originalCat = getCatalog(tech);
  const { modifiedData, validation } = buildModifiedCatalog(originalCat, {
    upsertedRules: (changes && changes.upsertedRules) || [],
    deletedRules: (changes && changes.deletedRules) || [],
  });
  if (!validation.valid) {
    return res.status(400).json({ error: 'Validation failed', validation });
  }
  const rulesOnly = {
    technology: modifiedData.technology,
    catalog_version: modifiedData.version,
    exported_at: new Date().toISOString(),
    consistency_rules: modifiedData.consistency_rules,
  };
  const filename = `${tech}-consistency-rules.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(rulesOnly, null, 2) + '\n');
});

// API: single metric detail
router.get('/:tech/detail/:metricId', (req, res) => {
  const cat = getCatalog(req.params.tech);
  const metric = cat.getById(req.params.metricId);
  if (!metric) return res.status(404).json({ error: 'Metric not found' });

  const sub = cat.getSubcategory(metric.subcategory);
  const pillar = sub ? cat.getPillar(sub.pillar) : null;
  const weight = cat.getEffectiveWeight(metric);

  // How it scores: share of the subcategory points, and what a failure does.
  const siblings = cat.metrics.filter(m => m.subcategory === metric.subcategory);
  const pool = siblings.reduce((sum, m) => sum + cat.getEffectiveWeight(m), 0);
  const pointsShare = sub && pool ? Math.round((weight / pool) * sub.maxPoints * 100) / 100 : 0;
  const gatePct = Math.round(SCORING_POLICY.subcategoryGateCapPct * 100);
  const pillarPct = Math.round(SCORING_POLICY.pillarCriticalCapPct * 100);
  let gateEffect;
  if (metric.gate_scope === 'pillar') {
    gateEffect = `Pillar gate: a failure zeroes the whole ${pillar ? pillar.name : ''} pillar. A missing value caps the pillar at ${pillarPct} percent.`;
  } else if (metric.criticality === 'critical') {
    gateEffect = `Critical: a failure caps ${sub ? sub.name : 'the subcategory'} at ${gatePct} percent of its ${sub ? sub.maxPoints : ''} points; a hard failure or a missing value also caps the ${pillar ? pillar.name : ''} pillar at ${pillarPct} percent.`;
  } else {
    gateEffect = `${metric.criticality === 'important' ? 'Important' : 'Advisory'}: a failure only removes this metric's share of the points; no gate.`;
  }

  // Rules that mention this metric (as a condition or as a target).
  const name = metric.legacy_name;
  const mentions = (obj) => JSON.stringify(obj || {}).includes(`"${name}"`);
  const referencingRules = (cat.getConsistencyRules() || [])
    .filter(r => mentions(r.applies_when) || mentions((r.on_violation || {}).score_adjustment) || mentions((r.on_violation || {}).score_adjustments))
    .map(r => {
      const ov = r.on_violation || {};
      const adjs = ov.score_adjustments || (ov.score_adjustment ? [ov.score_adjustment] : []);
      const adjText = adjs.filter(a => a && a.type && a.type !== 'none')
        .map(a => a.type === 'subcategory_cap' ? `cap ${a.target} at ${a.cap_pct} percent` : a.type === 'metric_zero' ? `zero ${a.target}` : `${a.type.replace('_', ' ')} ${a.points || ''} ${a.target || ''}`.trim())
        .join('; ') || 'finding only';
      return { rule_id: r.rule_id, title: r.title, severity: ov.severity || r.severity || 'info', adjustment: adjText, condition: humanizePredicate(r.applies_when) };
    });

  const df = metric.derived_from || {};
  const formula = metric.derived ? (SCORING_POLICY.derivedFormulas[df.formula] || null) : null;

  res.json({
    ...metric,
    _subcategoryName: sub ? sub.name : 'Unknown',
    _subcategoryMaxPoints: sub ? sub.maxPoints : 0,
    _subcategoryPool: pool,
    _pillarName: pillar ? pillar.name : 'Unknown',
    _effectiveWeight: weight,
    _pointsShare: pointsShare,
    _gateEffect: gateEffect,
    _criteriaText: describeCriteria(metric),
    _partialCreditText: `${Math.round(SCORING_POLICY.partialCredit.factor * 100)} percent of the points within ${SCORING_POLICY.partialCredit.withinMultiple}x of the bound`,
    _appliesWhenText: metric.applies_when ? humanizePredicate(metric.applies_when) : '',
    // 1.16.0: the declared targets under which this check counts but is not
    // required (no gate, no disposition item, out of the target).
    _optionalWhenText: metric.optional_when ? humanizePredicate(metric.optional_when) : '',
    _derivedExpression: formula ? formula.expression : '',
    _referencingRules: referencingRules,
  });
});

module.exports = router;
