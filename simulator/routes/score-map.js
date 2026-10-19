'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../../src');
const ScoringEngine = require('../../src/scoring/engine');
const { buildGraph } = require('../lib/graph-builder');

const SAMPLES_DIR = path.resolve(__dirname, '../../data/samples');
const WORKLOAD_PROFILES = ['mixed', 'oltp', 'olap', 'default'];

function loadSample(tech, scenario) {
  const filePath = path.join(SAMPLES_DIR, `${tech}-${scenario}.json`);
  if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return null;
}

function listSamples(tech) {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs.readdirSync(SAMPLES_DIR)
    .filter((f) => f.startsWith(`${tech}-`) && f.endsWith('.json'))
    .map((f) => f.slice(tech.length + 1, -'.json'.length));
}

/**
 * Shape an engine result into the compact bundle the client highlight logic
 * consumes (same field names as the /simulate/:tech/calculate JSON response,
 * so scoreMapHighlightFromResult() works for both live and baked-export use).
 */
function highlightResult(result) {
  const pillars = {};
  for (const [id, p] of Object.entries(result.pillars)) {
    pillars[id] = { name: p.name, score: p.score, maxScore: p.maxScore, percentage: p.percentage, target: p.target, targetAttainment: p.targetAttainment, status: p.status };
  }
  // Per-subcategory rollup (drives the progressive drill cards). Compact —
  // names come from the graph index client-side, so only the live numbers ship.
  const subcategories = {};
  for (const [id, s] of Object.entries(result.subcategories || {})) {
    subcategories[id] = { score: s.score, maxScore: s.maxScore, percentage: s.percentage, target: s.target, targetAttainment: s.targetAttainment, status: s.status, hasCriticalFailure: s.hasCriticalFailure };
  }
  return {
    firedRules: result.allFindings.filter((f) => f.kind === 'consistency').map((f) => f.rule_id),
    metrics: result.allMetrics.map((m) => ({
      name: m.name,
      applicable: m.applicable !== false,
      scored: !!m.scored,
      passed: m.scored ? (m.score >= m.maxScore) : false,
      score: m.score,
      maxScore: m.maxScore,
      value: m.value,
    })),
    notApplicable: result.allMetrics.filter((m) => m.applicable === false).map((m) => ({ name: m.name })),
    pillars,
    subcategories,
  };
}

function coerceContext(body) {
  const values = (body && body.values && typeof body.values === 'object') ? body.values : {};
  const rawFacts = (body && body.systemFacts) || {};
  const systemFacts = {};
  for (const key of ['ram_kb', 'cpu_count', 'storage_size_kb']) {
    const v = rawFacts[key];
    if (v === undefined || v === '' || v === null) continue;
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) systemFacts[key] = n;
  }
  const workloadProfile = WORKLOAD_PROFILES.includes(body && body.workloadProfile) ? body.workloadProfile : 'mixed';
  return { values, systemFacts, workloadProfile };
}

/** Read the vendored browser bundles from simulator/node_modules for inlining. */
function readVendor() {
  const cyDist = path.dirname(require.resolve('cytoscape')); // .../cytoscape/dist
  const dgRoot = path.dirname(require.resolve('dagre'));      // .../dagre
  return {
    dagreJs: fs.readFileSync(path.join(dgRoot, 'dist/dagre.min.js'), 'utf8'),
    cytoscapeJs: fs.readFileSync(path.join(cyDist, 'cytoscape.min.js'), 'utf8'),
    cytoscapeDagreJs: fs.readFileSync(require.resolve('cytoscape-dagre'), 'utf8'),
    styleJs: fs.readFileSync(path.join(__dirname, '../public/js/score-map-style.js'), 'utf8'),
  };
}

// --- Live page --------------------------------------------------------------
router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) return res.status(404).send('Technology not found');

  const cat = getCatalog(tech);
  const graph = buildGraph(cat);
  const scenario = req.query.scenario || 'healthy';
  const sample = loadSample(tech, scenario);
  const values = sample ? sample.values : {};
  const systemFacts = (sample && sample.systemFacts) || {};
  const workloadProfile = (sample && sample.workloadProfile) || 'mixed';

  const engine = new ScoringEngine(tech);
  const result = engine.calculate(values, { systemFacts, workloadProfile });

  res.render('score-map', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    graph,
    meta: graph.meta,
    result: highlightResult(result),
    values,
    scenario,
    samples: listSamples(tech),
    workloadProfiles: WORKLOAD_PROFILES,
    workloadProfile,
    systemFacts,
    activePage: 'score-map',
  });
});

// --- Self-contained HTML export (POST so current values/facts bake the highlight)
router.post('/:tech/export', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) return res.status(400).json({ error: 'Unsupported technology' });

  let vendor;
  try {
    vendor = readVendor();
  } catch (e) {
    return res.status(500).send('Visualization libraries not installed. Run `npm install` in the simulator/ directory.');
  }

  const cat = getCatalog(tech);
  const graph = buildGraph(cat);
  const { values, systemFacts, workloadProfile } = coerceContext(req.body);
  const engine = new ScoringEngine(tech);
  const result = engine.calculate(values, { systemFacts, workloadProfile });

  res.render('score-map-export', {
    tech,
    graph,
    meta: graph.meta,
    result: highlightResult(result),
    scenario: (req.body && req.body.scenario) || '',
    dagreJs: vendor.dagreJs,
    cytoscapeJs: vendor.cytoscapeJs,
    cytoscapeDagreJs: vendor.cytoscapeDagreJs,
    styleJs: vendor.styleJs,
  }, (err, html) => {
    if (err) return res.status(500).send('Export render error: ' + err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="score-map-${tech}.html"`);
    res.send(html);
  });
});

module.exports = router;
