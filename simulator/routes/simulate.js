'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../../src');
const ScoringEngine = require('../../src/scoring/engine');
// Declared-target detection, waived checks and the gain rule (1.16.0).
const { computeNextRungs } = require('../lib/ladder');

const SAMPLES_DIR = path.resolve(__dirname, '../../data/samples');

// Licensed options offered for a technology = the distinct `license_requirement`
// values its own catalog actually references (empty for open-source techs like
// PostgreSQL, so the panel hides itself). NOT the global
// RECOGNIZED_LICENSE_REQUIREMENTS validation whitelist — using that made every
// technology show Oracle's packs.
function licenseOptionsFor(cat) {
  const opts = new Set();
  for (const m of cat.getActiveMetrics({ mode: 'standalone' })) {
    if (m.license_requirement) opts.add(m.license_requirement);
  }
  return [...opts].sort();
}

function loadSample(tech, scenario) {
  const filePath = path.join(SAMPLES_DIR, `${tech}-${scenario}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return null;
}


const WORKLOAD_PROFILES = ['mixed', 'oltp', 'olap', 'default'];

const { checkPayload } = require('../../src/catalog/payload-check');

// Simulator 2.0 — shape report of a pasted collector payload against the
// catalog (not provided / not applicable / unparseable / enum mismatch /
// unit suspect). Never scores; the client loads the values into the form.
router.post('/:tech/check-payload', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }
  const body = req.body || {};
  const values = body.values && typeof body.values === 'object' ? body.values : body;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ error: 'Expected a JSON object of values, or an object with a "values" key' });
  }
  const options = {
    systemFacts: body.systemFacts, workloadProfile: body.workloadProfile, licensedOptions: body.licensedOptions,
    mode: body.mode, pgVersion: body.pgVersion, serverVersion: body.serverVersion, deploymentProfile: body.deploymentProfile,
    installedExtensions: body.installedExtensions, availableSources: body.availableSources,
  };
  try {
    res.json(checkPayload(tech, values, options));
  } catch (e) {
    // A failure inside the checker is a server bug, not a bad request.
    res.status(500).json({ error: `Payload check failed: ${e.message}` });
  }
});

router.get('/:tech', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(404).send('Technology not found');
  }

  const cat = getCatalog(tech);
  const scenario = req.query.scenario || 'healthy';
  const sample = loadSample(tech, scenario);
  const values = sample ? sample.values : {};
  const systemFactsFromSample = (sample && sample.systemFacts) || {};
  const workloadProfile = (sample && sample.workloadProfile) || 'mixed';
  const licensedOptions = (sample && sample.licensedOptions) || [];

  // Get active metrics organized by pillar/subcategory
  const activeMetrics = cat.getActiveMetrics({ mode: 'standalone' });
  const structure = [];

  for (const pillarId of cat.getPillarIds()) {
    const pillar = cat.getPillar(pillarId);
    const subcatIds = cat.getSubcategoryIds(pillarId);
    const subcategories = [];

    for (const subcatId of subcatIds) {
      const sub = cat.getSubcategory(subcatId);
      const metrics = activeMetrics
        .filter(m => m.subcategory === subcatId)
        .map(m => ({
          ...m,
          currentValue: values[m.legacy_name] !== undefined ? values[m.legacy_name] : '',
          effectiveWeight: cat.getEffectiveWeight(m),
        }));

      if (metrics.length > 0) {
        subcategories.push({ id: subcatId, name: sub.name, maxPoints: sub.maxPoints, metrics });
      }
    }

    structure.push({ id: pillarId, name: pillar.name, maxPoints: pillar.maxPoints, subcategories });
  }

  // Compute initial score
  const engine = new ScoringEngine(tech);
  const result = engine.calculate(values, {
    systemFacts: systemFactsFromSample,
    workloadProfile,
    licensedOptions,
  });

  // v1.5.0 — Maturity ladder: per declared target, the live next-rung advisor
  // (current state, per-rung score deltas + coherence, recommended next step),
  // computed by probing the real engine. Seeds the section at first paint; the
  // client re-renders it from the same shape after each recalc.
  const nextRungs = computeNextRungs(tech, values, {
    systemFacts: systemFactsFromSample,
    workloadProfile,
    licensedOptions,
  }, result);

  // Available samples (any tech-<scenario>.json, not just healthy/critical, so oltp/olap surface here)
  const samples = fs.existsSync(SAMPLES_DIR)
    ? fs.readdirSync(SAMPLES_DIR)
        .filter(f => f.startsWith(`${tech}-`) && f.endsWith('.json'))
        .map(f => f.slice(tech.length + 1, -'.json'.length))
    : [];

  res.render('simulate', {
    tech,
    technologies: SUPPORTED_TECHNOLOGIES,
    structure,
    result,
    scenario,
    samples,
    workloadProfiles: WORKLOAD_PROFILES,
    workloadProfile,
    systemFacts: systemFactsFromSample,
    licenseOptions: licenseOptionsFor(cat),
    licensedOptions,
    nextRungs,
    activePage: 'simulate',
  });
});

// API: recalculate score with updated values
router.post('/:tech/calculate', (req, res) => {
  const tech = req.params.tech;
  if (!SUPPORTED_TECHNOLOGIES.includes(tech)) {
    return res.status(400).json({ error: 'Unsupported technology' });
  }

  const values = req.body.values || {};

  // Convert string booleans and numeric strings into native types. JSON booleans
  // and numbers that arrive as native types are passed through unchanged — the
  // earlier "!isNaN(val) && parseFloat(val)" coerced booleans to NaN, which
  // silently failed every boolean metric.
  const cleaned = {};
  for (const [key, val] of Object.entries(values)) {
    if (val === '' || val === undefined || val === null) continue;
    if (typeof val === 'boolean' || typeof val === 'number') {
      cleaned[key] = val;
    } else if (val === 'true') {
      cleaned[key] = true;
    } else if (val === 'false') {
      cleaned[key] = false;
    } else if (typeof val === 'string' && val.trim() !== '' && !isNaN(val)) {
      cleaned[key] = parseFloat(val);
    } else {
      cleaned[key] = val;
    }
  }

  // systemFacts + workloadProfile arrive as { ram_kb, cpu_count, storage_size_kb }
  // and a profile string. Coerce numerics to numbers; drop blanks.
  const rawFacts = req.body.systemFacts || {};
  const systemFacts = {};
  for (const key of ['ram_kb', 'cpu_count', 'storage_size_kb']) {
    const v = rawFacts[key];
    if (v === undefined || v === '' || v === null) continue;
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) systemFacts[key] = n;
  }
  // edition is a string fact (v1.8.0): drives enterprise_edition auto-derive and
  // OR-CR-SECPOST-1. Pass through when set (validation whitelists the fact name,
  // not its value).
  if (typeof rawFacts.edition === 'string' && rawFacts.edition.trim()) {
    systemFacts.edition = rawFacts.edition.trim().toLowerCase();
  }
  const workloadProfile = WORKLOAD_PROFILES.includes(req.body.workloadProfile)
    ? req.body.workloadProfile
    : 'mixed';
  const allowedOptions = licenseOptionsFor(getCatalog(tech));
  const licensedOptions = Array.isArray(req.body.licensedOptions)
    ? req.body.licensedOptions.filter(o => allowedOptions.includes(o))
    : [];

  const engine = new ScoringEngine(tech);
  const result = engine.calculate(cleaned, { systemFacts, workloadProfile, licensedOptions });

  // v1.5.0 — recompute the maturity ladder against the fresh inputs so the
  // next-rung advisor moves live with the score.
  const nextRungs = computeNextRungs(tech, cleaned, { systemFacts, workloadProfile, licensedOptions }, result);

  // Simplify for JSON response
  const pillars = {};
  for (const [id, p] of Object.entries(result.pillars)) {
    pillars[id] = {
      name: p.name,
      score: p.score,
      maxScore: p.maxScore,
      percentage: p.percentage,
      target: p.target,
      targetAttainment: p.targetAttainment,
      status: p.status,
      findings: p.findings.length,
      ...(p.criticalGated ? { criticalGated: true } : {}),
    };
  }

  // Per-subcategory rollup — the Score Map drill cards read this after recalc
  // so a sub-category tile matches the engine's true (gated/capped) number.
  const subcategories = {};
  for (const [id, s] of Object.entries(result.subcategories || {})) {
    subcategories[id] = {
      score: s.score,
      maxScore: s.maxScore,
      percentage: s.percentage,
      target: s.target,
      targetAttainment: s.targetAttainment,
      status: s.status,
      hasCriticalFailure: s.hasCriticalFailure,
    };
  }

  const findings = result.allFindings
    .filter(f => f.severity !== 'ok' && f.severity !== 'info')
    .slice(0, 20)
    .map(f => ({
      severity: f.severity,
      title: f.title,
      description: f.description,
      remediation: f.remediation,
      rule_id: f.rule_id,
      kind: f.kind,
      score_movement: f.score_movement,
      score_movements: f.score_movements,
    }));

  // v1.8.0/v1.9.0 — metrics excluded by applies_when OR license; surfaced with the
  // exclusion_reason discriminator so the UI can split entitlement vs collected-state.
  const notApplicable = result.allMetrics
    .filter(m => m.applicable === false)
    .map(m => ({
      name: m.name,
      display_name: m.display_name,
      exclusion_reason: m.exclusion_reason || 'applies_when',
      license_requirement: m.license_requirement || null,
    }));
  const licenseExcluded = (result.licenseExcluded || []).length;

  // Score Map highlight inputs (additive — the Simulator UI ignores these):
  // which consistency rules fired, and a compact per-metric pass/applicable map.
  const firedRules = result.allFindings.filter(f => f.kind === 'consistency').map(f => f.rule_id);
  const metrics = result.allMetrics.map(m => ({
    name: m.name,
    applicable: m.applicable !== false,
    scored: !!m.scored,
    // A blank non-critical declaration keeps its full points (1.17.0).
    passed: m.scored ? (m.score >= m.maxScore) : !!m.undeclared,
    score: m.score,
    maxScore: m.maxScore,
    value: m.value,
    criticality: m.criticality,
    exclusion_reason: m.exclusion_reason || null,
    required: m.required !== false,
    zeroed_by_rules: m.zeroed_by_rules || null,
  }));

  res.json({
    totalScore: result.totalScore,
    totalMaxScore: result.totalMaxScore,
    totalPercentage: result.totalPercentage,
    targetScore: result.targetScore,
    pointsNotAssessed: result.pointsNotAssessed,
    targetAttainment: result.targetAttainment,
    onTarget: result.onTarget,
    requiredMissed: result.requiredMissed,
    status: result.status,
    disposition: result.disposition,
    context: result.context,
    coverage: result.coverage,
    pillars,
    subcategories,
    findingsCount: result.allFindings.length,
    findings,
    notApplicable,
    licenseExcluded,
    firedRules,
    metrics,
    nextRungs,
    recommendations: result.recommendations.slice(0, 10),
  });
});

module.exports = router;
