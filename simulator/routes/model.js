'use strict';

/**
 * "How the score works" — one screen rendered from SCORING_POLICY (the
 * engine's shared rules) plus the selected catalog. Nothing here is typed by
 * hand: every number comes from the policy object the engine itself reads.
 */

const express = require('express');
const router = express.Router();
const { getCatalog, SUPPORTED_TECHNOLOGIES, SCORING_POLICY } = require('../../src');

router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }
  const cat = getCatalog(tech);
  const w = SCORING_POLICY.criticalityWeights;

  const pillars = cat.getPillarIds().map(pillarId => {
    const pillar = cat.getPillar(pillarId);
    const subcategories = cat.getSubcategoryIds(pillarId).map(subId => {
      const sub = cat.getSubcategory(subId);
      const metrics = cat.metrics.filter(m => m.subcategory === subId);
      const counts = { critical: 0, important: 0, advisory: 0 };
      let pool = 0;
      for (const m of metrics) {
        counts[m.criticality] = (counts[m.criticality] || 0) + 1;
        pool += cat.getEffectiveWeight(m);
      }
      return { id: subId, name: sub.name, maxPoints: sub.maxPoints, metrics: metrics.length, counts, pool };
    });
    return { id: pillarId, name: pillar.name, maxPoints: pillar.maxPoints, subcategories };
  });

  // Worked example: first subcategory of the first pillar.
  const first = pillars[0] && pillars[0].subcategories[0];
  const example = first ? {
    ...first,
    pillarName: pillars[0].name,
    advisoryPoints: first.pool ? Math.round((w.advisory / first.pool) * first.maxPoints * 100) / 100 : 0,
    criticalPoints: first.pool ? Math.round((w.critical / first.pool) * first.maxPoints * 100) / 100 : 0,
  } : null;

  const gateMetrics = cat.metrics.filter(m => m.gate_scope === 'pillar').map(m => ({
    metric_id: m.metric_id, display_name: m.display_name, criticality: m.criticality,
    pillarName: (cat.getPillar(cat.getSubcategory(m.subcategory).pillar) || {}).name,
  }));

  const derivedMetrics = cat.metrics.filter(m => m.derived).map(m => {
    const df = m.derived_from || {};
    const f = SCORING_POLICY.derivedFormulas[df.formula] || {};
    return { metric_id: m.metric_id, display_name: m.display_name, formula: df.formula, inputs: df.inputs || [], expression: f.expression || '', unit: f.unit || '', description: f.description || '' };
  });

  res.render('model', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    catalog: cat,
    policy: SCORING_POLICY,
    pillars,
    example,
    gateMetrics,
    derivedMetrics,
    ruleCount: (cat.getConsistencyRules() || []).length,
    anchoredCount: cat.metrics.filter(m => m.technical_anchor).length,
    activePage: 'model',
  });
});

module.exports = router;
