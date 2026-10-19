'use strict';

const { getCatalog } = require('../../src');
const ScoringEngine = require('../../src/scoring/engine');

/**
 * Maturity-ladder advisor (moved from routes/simulate.js in 1.16.0), kept free
 * of Express so the root test suite can load and test it.
 */

// Catalogs not yet flagged (MySQL, MariaDB, SQL Server, MongoDB) keep the
// pre-1.16.0 detection by name and shape, so their ladder does not vanish.
const LEGACY_TARGET_NAMES = new Set([
  'rpo_target', 'rto_target', 'security_posture', 'growth_headroom_target',
  'ha_topology', 'dr_topology',
]);

/** Whether a catalog metric is a declared target; `flagged` = the catalog uses declared_target. */
function isTarget(m, flagged) {
  if (flagged) return m.declared_target === true;
  return m.evaluation_type === 'enum'
    && Array.isArray(m.sources) && m.sources.includes('manual')
    && LEGACY_TARGET_NAMES.has(m.legacy_name);
}

// States where the current declaration is missing, failed or invalidated by
// evidence: declaring a coherent rung, even a looser one, is a fix (declaring
// the honest constraint), not a loosening.
const FIX_STATES = new Set(['undeclared', 'unmet', 'invalidated']);

/**
 * A coherent rung that raises the score is a gain. Under an honored
 * declaration only a rung that keeps or raises the target qualifies: a looser
 * declaration moves the target down, and coaching it would be the gaming path
 * the declarations fingerprint exposes (score-and-target decision, DEC-026).
 */
function isGainRung(rung, state) {
  // In a fix state a coherent rung is a fix even when the score does not move
  // (1.17.0: a blank non-critical declaration already keeps its full points).
  const moves = rung.delta > 0 || (FIX_STATES.has(state) && rung.delta === 0);
  return rung.coherent && moves && (rung.targetDelta >= 0 || FIX_STATES.has(state));
}

// v1.5.0 — Maturity "next rung" advisor. For each applicable declared target,
// probe every value on its ladder (pass_values) through the *real* engine, with
// all other inputs held constant, and read back the score delta + whether that
// rung stays coherent (target not zeroed by a rule). The engine is the oracle —
// no score math is re-derived here, so every cap/gate/rule interaction is honest.
// A `+N` gain is reported only on rungs proven coherent now; incoherent rungs are
// surfaced as "reach for" steps carrying the fired rule's real remediation prose.
function computeNextRungs(tech, values, opts, baseline) {
  const cat = getCatalog(tech);
  const engine = new ScoringEngine(tech);
  const flagged = cat.metrics.some(m => m.declared_target === true);
  const targets = cat.getActiveMetrics({ mode: 'standalone' }).filter(m => isTarget(m, flagged));
  const baseScore = baseline.totalScore;
  const baseTarget = baseline.targetScore;
  const baseByName = new Map((baseline.allMetrics || []).map(m => [m.name, m]));

  // Remediation prose for the rule(s) that zeroed a target, pulled from the
  // consistency findings of whichever run produced them (catalog-driven, not
  // hardcoded here).
  const evidenceFor = (result, ruleIds) => {
    if (!ruleIds || !ruleIds.length) return null;
    const want = new Set(ruleIds);
    const texts = (result.allFindings || [])
      .filter(f => f.kind === 'consistency' && want.has(f.rule_id) && f.remediation)
      .map(f => f.remediation);
    return texts.length ? [...new Set(texts)].join(' ') : null;
  };

  return targets.map(m => {
    const sub = cat.getSubcategory(m.subcategory);
    const pillarId = sub ? sub.pillar : null;
    const pillar = pillarId ? cat.getPillar(pillarId) : null;
    const ladder = (m.evaluation_config || {}).pass_values || [];
    const current = values[m.legacy_name];
    const hasCurrent = current !== undefined && current !== null && current !== '';

    const baseM = baseByName.get(m.legacy_name);
    const currentZeroing = (baseM && baseM.zeroed_by_rules) || [];
    // honored only when the declaration actually earns its points; a declared but
    // non-passing value (e.g. a value outside pass_values) is 'unmet', distinct
    // from a coherence rule zeroing it ('invalidated').
    const currentPassed = !!(baseM && baseM.scored) && baseM.score >= baseM.maxScore;
    const state = !hasCurrent ? 'undeclared'
      : currentZeroing.length ? 'invalidated'
      : currentPassed ? 'honored'
      : 'unmet';
    const currentEvidence = state === 'invalidated' ? evidenceFor(baseline, currentZeroing) : null;

    const rungs = ladder.map(v => {
      const r = engine.calculate({ ...values, [m.legacy_name]: v }, opts);
      const pm = (r.allMetrics || []).find(x => x.name === m.legacy_name);
      const zeroing = (pm && pm.zeroed_by_rules) || [];
      const coherent = !!(pm && pm.scored) && zeroing.length === 0;
      // 1.16.0: a declaration never switches a check off; it moves the target.
      return {
        value: v,
        delta: Math.round((r.totalScore - baseScore) * 100) / 100,
        targetDelta: Math.round((r.targetScore - baseTarget) * 100) / 100,
        openCriticals: r.disposition.items.length,
        coherent,
        zeroingRules: zeroing,
        evidence: coherent ? null : evidenceFor(r, zeroing),
      };
    });

    // Recommendation: the best coherent gain (Δ>0) if any; else the nearest
    // incoherent rung to "reach for"; else null (top of the ladder). A rung that
    // lowers the target counts as a gain only in a fix state (the current
    // declaration is missing, failed or invalidated), never when loosening an
    // honored declaration; a reach-for rung never lowers the target.
    // An honored declaration: the biggest score gain. A missing, failed or
    // invalidated one: the honest rung, i.e. the one that leaves no critical
    // problem open, then the strictest (highest target) the evidence supports,
    // never simply the loosest that scores most.
    const honestFirst = FIX_STATES.has(state);
    const gains = rungs.filter(r => isGainRung(r, state) && String(r.value) !== String(current)).sort((a, b) => (honestFirst
      ? (a.openCriticals - b.openCriticals) || (b.targetDelta - a.targetDelta) || (b.delta - a.delta)
      : (b.delta - a.delta) || (b.targetDelta - a.targetDelta)));
    let recommendation = null;
    if (gains.length) {
      recommendation = { kind: FIX_STATES.has(state) ? 'fix' : 'gain', value: gains[0].value, delta: gains[0].delta, targetDelta: gains[0].targetDelta, evidence: null };
    } else {
      const reach = rungs
        .filter(r => !r.coherent && r.targetDelta >= 0 && String(r.value) !== String(current))
        .sort((a, b) => b.delta - a.delta)[0];
      if (reach) recommendation = { kind: 'aspiration', value: reach.value, delta: reach.delta, evidence: reach.evidence };
    }

    return {
      legacy_name: m.legacy_name,
      metric_id: m.metric_id,
      display_name: m.display_name,
      pillar: pillarId,
      pillarName: pillar ? pillar.name : (pillarId || 'Other'),
      current: hasCurrent ? current : null,
      state,
      currentEvidence,
      rungs,
      recommendation,
    };
  });
}

module.exports = { isTarget, isGainRung, computeNextRungs, FIX_STATES, LEGACY_TARGET_NAMES };
