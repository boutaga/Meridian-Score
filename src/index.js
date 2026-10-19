'use strict';

/**
 * @dbi-services/scoring-core
 *
 * Universal database health scoring engine.
 * 5-pillar, 100-point framework with criticality gates.
 *
 * Supports: PostgreSQL, MySQL, MariaDB, MongoDB, Oracle, SQL Server
 */

const ScoringEngine = require('./scoring/engine');
const { MetricCatalog, catalog, getCatalog } = require('./catalog');
const { evaluateMetric, evaluateEnum, evaluateThreshold } = require('./scoring/evaluator');
const { evaluatePredicate, evaluateRules, applyAdjustments } = require('./scoring/consistency');
const { CRITICALITY_WEIGHTS, SUPPORTED_TECHNOLOGIES } = require('./catalog/constants');
const { DEFAULT_METRICS, AZURE_POLICY_METRICS } = require('./policies/defaults');
const catalogValidation = require('./catalog/validation');
const { SCORING_POLICY } = require('./scoring/policy');
const { rulesFingerprint, declarationsFingerprint, fingerprints } = require('./fingerprint');
const { exportRulesBundle, loadRulesBundle } = require('./bundle');

module.exports = {
  ScoringEngine,
  MetricCatalog,
  catalog,
  getCatalog,
  evaluateMetric,
  evaluateEnum,
  evaluateThreshold,
  evaluatePredicate,
  evaluateRules,
  applyAdjustments,
  CRITICALITY_WEIGHTS,
  SUPPORTED_TECHNOLOGIES,
  DEFAULT_METRICS,
  AZURE_POLICY_METRICS,
  catalogValidation,
  SCORING_POLICY,
  rulesFingerprint,
  declarationsFingerprint,
  fingerprints,
  exportRulesBundle,
  loadRulesBundle,
};
