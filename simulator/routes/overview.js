'use strict';

const express = require('express');
const router = express.Router();
const { getCatalog, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS } = require('../../src');

router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }

  const cat = getCatalog(tech);

  // Build pillar/subcategory structure
  const pillarData = [];
  for (const pillarId of cat.getPillarIds()) {
    const pillar = cat.getPillar(pillarId);
    const subcatIds = cat.getSubcategoryIds(pillarId);
    const subcategories = subcatIds.map(id => {
      const sub = cat.getSubcategory(id);
      const metrics = cat.metrics.filter(m => m.subcategory === id);
      return {
        id,
        name: sub.name,
        maxPoints: sub.maxPoints,
        metricCount: metrics.length,
        criticalCount: metrics.filter(m => m.criticality === 'critical').length,
        importantCount: metrics.filter(m => m.criticality === 'important').length,
        advisoryCount: metrics.filter(m => m.criticality === 'advisory').length,
      };
    });

    const pillarMetrics = cat.metrics.filter(m => {
      const sub = cat.getSubcategory(m.subcategory);
      return sub && sub.pillar === pillarId;
    });

    pillarData.push({
      id: pillarId,
      name: pillar.name,
      maxPoints: pillar.maxPoints,
      subcategories,
      metricCount: pillarMetrics.length,
      criticalCount: pillarMetrics.filter(m => m.criticality === 'critical').length,
    });
  }

  // Source distribution
  const sourceCounts = { sql: 0, manual: 0, monitoring: 0 };
  for (const m of cat.metrics) {
    for (const s of m.sources) {
      if (s === 'sql') sourceCounts.sql++;
      else if (s === 'manual') sourceCounts.manual++;
      else sourceCounts.monitoring++;
    }
  }

  res.render('overview', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    catalog: cat,
    pillarData,
    sourceCounts,
    criticalityWeights: CRITICALITY_WEIGHTS,
    activePage: 'overview',
  });
});

module.exports = router;
