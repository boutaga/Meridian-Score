'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getCatalog, MetricCatalog, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS, exportRulesBundle } = require('../../src');
const ScoringEngine = require('../../src/scoring/engine');
const { buildModifiedCatalog } = require('../lib/catalog-builder');
const { catalogFingerprint } = require('../../src/fingerprint');

const SAMPLES_DIR = path.resolve(__dirname, '../../data/samples');

function loadSample(tech, scenario) {
  const filePath = path.join(SAMPLES_DIR, `${tech}-${scenario}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return null;
}


router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }

  const cat = getCatalog(tech);

  // Build editable structure grouped by pillar/subcategory
  const subcategories = [];
  for (const pillarId of cat.getPillarIds()) {
    const subcatIds = cat.getSubcategoryIds(pillarId);
    for (const subcatId of subcatIds) {
      const sub = cat.getSubcategory(subcatId);
      const metrics = cat.metrics
        .filter(m => m.subcategory === subcatId)
        .map(m => ({
          metric_id: m.metric_id,
          legacy_name: m.legacy_name,
          display_name: m.display_name,
          criticality: m.criticality,
          evaluation_type: m.evaluation_type,
          sources: m.sources,
          effectiveWeight: cat.getEffectiveWeight(m),
          derived: m.derived === true,
          derived_from: m.derived_from || null,
          evaluation_config: m.evaluation_config || {},
          // Flat shapes are editable in the UI; profile-keyed, size-relative and
          // declaration-keyed thresholds (and derived metrics) stay read-only.
          editableThreshold: m.derived !== true && !(m.evaluation_config && (m.evaluation_config.profiles || m.evaluation_config.by_declaration || m.evaluation_config.min_pct !== undefined || m.evaluation_config.max_pct !== undefined)),
        }));

      subcategories.push({
        id: subcatId,
        name: sub.name,
        pillar: pillarId,
        pillarName: cat.getPillar(pillarId).name,
        maxPoints: sub.maxPoints,
        metrics,
      });
    }
  }

  res.render('impact', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    catalog: cat,
    subcategories,
    criticalityWeights: CRITICALITY_WEIGHTS,
    activePage: 'impact',
  });
});

// API: compare original vs modified scoring
router.post('/:tech/compare', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }

  const { changes, scenario } = req.body;

  const originalCat = getCatalog(tech);
  const sample = loadSample(tech, scenario || 'healthy');
  const sampleValues = sample ? sample.values : {};

  // Calculate original score
  const originalEngine = new ScoringEngine(tech);
  const originalResult = originalEngine.calculate(sampleValues);

  // Build modified catalog
  const { modifiedData, validation, values } = buildModifiedCatalog(originalCat, changes, sampleValues);

  // Calculate modified score
  const modifiedCat = MetricCatalog.fromData(tech, modifiedData);
  const modifiedEngine = new ScoringEngine(tech, { catalog: modifiedCat });
  const modifiedResult = modifiedEngine.calculate(values);

  // Build comparison
  const disabledMetrics = changes.disabledMetrics || [];
  const newMetrics = changes.newMetrics || [];
  const comparison = {
    original: {
      totalScore: originalResult.totalScore,
      totalPercentage: originalResult.totalPercentage,
      status: originalResult.status,
      disposition: originalResult.disposition,
      metricCount: originalCat.metrics.length,
      pillars: {},
    },
    modified: {
      totalScore: modifiedResult.totalScore,
      totalPercentage: modifiedResult.totalPercentage,
      status: modifiedResult.status,
      disposition: modifiedResult.disposition,
      metricCount: modifiedData.metrics.length,
      pillars: {},
    },
    diff: {
      totalScore: modifiedResult.totalScore - originalResult.totalScore,
      totalPercentage: modifiedResult.totalPercentage - originalResult.totalPercentage,
      metricCount: modifiedData.metrics.length - originalCat.metrics.length,
    },
    changes: {
      removed: disabledMetrics.length,
      added: newMetrics.filter(nm => nm.metric_id && nm.subcategory && nm.legacy_name).length,
      criticalityChanged: Object.keys(changes.metricCriticality || {}).length,
      pointsChanged: Object.keys(changes.subcategoryPoints || {}).length,
      rulesUpserted: (changes.upsertedRules || []).length,
      rulesDeleted: (changes.deletedRules || []).length,
    },
    consistencyFindings: {
      original: originalResult.allFindings.filter(f => f.kind === 'consistency').map(f => ({ rule_id: f.rule_id, title: f.title })),
      modified: modifiedResult.allFindings.filter(f => f.kind === 'consistency').map(f => ({ rule_id: f.rule_id, title: f.title })),
    },
    validation,
  };

  for (const pillarId of originalCat.getPillarIds()) {
    const op = originalResult.pillars[pillarId];
    const mp = modifiedResult.pillars[pillarId];
    comparison.original.pillars[pillarId] = { name: op.name, score: op.score, percentage: op.percentage };
    comparison.modified.pillars[pillarId] = { name: mp.name, score: mp.score, percentage: mp.percentage };
  }

  res.json(comparison);
});

// API: export the modified catalog as a rules bundle (1.16.0). The bundle's
// rules fingerprint identifies the edited catalog, instead of a borrowed
// version label with a "-modified" suffix.
router.post('/:tech/export', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }

  const { changes } = req.body;
  const originalCat = getCatalog(tech);
  const { modifiedData, validation } = buildModifiedCatalog(originalCat, changes);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed — cannot export invalid catalog',
      validation,
    });
  }

  // An edited catalog never carries the official version label alone (catalog
  // version equals catalog content, DEC-005): the edit is marked in the version.
  if (catalogFingerprint(MetricCatalog.fromData(tech, modifiedData)) !== catalogFingerprint(originalCat)) {
    modifiedData.version = `${modifiedData.version}+edited`;
  }
  const bundle = exportRulesBundle(tech, { catalog: MetricCatalog.fromData(tech, modifiedData) });
  const filename = `${tech}-rules-bundle-${bundle.fingerprint.rules.slice(0, 12)}.json`;
  const json = JSON.stringify(bundle, null, 2) + '\n';

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(json);
});

module.exports = router;
