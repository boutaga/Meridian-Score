'use strict';

/**
 * MetricCatalog — loads the JSON metric catalog and provides indexed access.
 *
 * The catalog is the single source of truth for all metric definitions.
 *
 * Scoring model:
 * - Each metric has a criticality (critical=3, important=2, advisory=1) or weight override
 * - Metrics are grouped into subcategories, each with a maxPoints budget
 * - Within a subcategory, scores are weighted-normalized to fit the maxPoints
 * - If ANY critical metric fails in a subcategory, the subcategory score is capped at 60%
 * - Pillar score = sum of subcategory scores (capped at pillar maxPoints=20)
 * - Total = sum of pillar scores (max 100)
 */

const { CATALOG_FILES, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS, MIN_VERSION_FIELDS } = require('./constants');

/**
 * Compare two versions: negative when a < b, 0 when equal, positive when a > b,
 * or null when they cannot be compared. Integers (PostgreSQL server_version_num)
 * compare numerically; dotted versions compare part by part, a missing part
 * counting as 0, trailing text after a part ignored ("10.6.12-MariaDB" reads as
 * 10.6.12). Not comparable, so no filtering (the metric stays active, as a
 * non-numeric version always did): a version that does not start with a number
 * ("PostgreSQL 17.2", "v8.0"), or one side dotted and the other a plain integer
 * of five digits or more ("17.2" against server_version_num 170000).
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const s = String(v).trim();
    if (!/^\d/.test(s)) return null;
    return s.split('.').map((p) => parseInt(p, 10) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  const isNum = (p) => p.length === 1 && p[0] >= 10000;
  if (isNum(pa) !== isNum(pb) && (pa.length > 1 || pb.length > 1)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The server version a run filters on: serverVersion when it carries a value,
// otherwise its alias pgVersion (an empty serverVersion never masks pgVersion).
function effectiveServerVersion(options) {
  const present = (v) => v !== undefined && v !== null && v !== '';
  if (present(options.serverVersion)) return options.serverVersion;
  if (present(options.pgVersion)) return options.pgVersion;
  return null;
}

// Exclusion reasons that come from the collection scope of the run (which
// collectors ran), as opposed to genuine non-applicability to the estate.
const SCOPE_EXCLUSIONS = new Set(['mode', 'source']);

/**
 * Load catalog data for a given technology from the embedded JSON file.
 * @param {string} technology
 * @returns {Object} Catalog data ({ version, pillars, subcategories, metrics })
 */
function loadCatalogData(technology) {
  const file = CATALOG_FILES[technology];
  if (!file) throw new Error(`Unsupported technology: ${technology}. Supported: ${SUPPORTED_TECHNOLOGIES.join(', ')}`);
  return require(file);
}

class MetricCatalog {
  /**
   * Create a MetricCatalog by loading from the embedded JSON file.
   * @param {string} [technology='postgresql'] - Database technology to load catalog for
   */
  constructor(technology = 'postgresql') {
    const catalogData = loadCatalogData(technology);
    this._init(technology, catalogData);
  }

  /**
   * Create a MetricCatalog from an already-loaded data object.
   * Use this when loading catalog data from a database or external source.
   * @param {string} technology - Technology identifier
   * @param {Object} catalogData - { version, pillars, subcategories, metrics }
   * @returns {MetricCatalog}
   */
  static fromData(technology, catalogData) {
    const instance = Object.create(MetricCatalog.prototype);
    instance._init(technology, catalogData);
    return instance;
  }

  /** @private */
  _init(technology, catalogData) {
    this.technology = technology;
    this.version = catalogData.version;
    this.maturity = catalogData.maturity || null;
    this.pillars = catalogData.pillars;
    this.subcategories = catalogData.subcategories;
    this.metrics = catalogData.metrics;
    this.consistencyRules = Array.isArray(catalogData.consistency_rules)
      ? catalogData.consistency_rules
      : [];

    // Build indexes
    this._byId = new Map();
    this._byLegacyName = new Map();
    this._byPillar = new Map();
    this._bySubcategory = new Map();

    for (const metric of this.metrics) {
      this._byId.set(metric.metric_id, metric);
      this._byLegacyName.set(metric.legacy_name, metric);

      const sub = this.subcategories[metric.subcategory];
      if (!sub) continue;
      const pillar = sub.pillar;

      if (!this._byPillar.has(pillar)) this._byPillar.set(pillar, []);
      this._byPillar.get(pillar).push(metric);

      if (!this._bySubcategory.has(metric.subcategory)) this._bySubcategory.set(metric.subcategory, []);
      this._bySubcategory.get(metric.subcategory).push(metric);
    }
  }

  /**
   * Get a metric by its catalog ID (e.g. "BAK-1.1").
   */
  getById(metricId) {
    return this._byId.get(metricId) || null;
  }

  /**
   * Get a metric by its legacy name (e.g. "archive_mode").
   */
  getByLegacyName(name) {
    return this._byLegacyName.get(name) || null;
  }

  /**
   * Get all pillar IDs.
   */
  getPillarIds() {
    return Object.keys(this.pillars);
  }

  /**
   * Get pillar definition.
   */
  getPillar(pillarId) {
    return this.pillars[pillarId] || null;
  }

  /**
   * Get all subcategory IDs for a pillar, sorted by order.
   */
  getSubcategoryIds(pillarId) {
    return Object.entries(this.subcategories)
      .filter(([, sub]) => sub.pillar === pillarId)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
  }

  /**
   * Get subcategory definition.
   */
  getSubcategory(subcategoryId) {
    return this.subcategories[subcategoryId] || null;
  }

  /**
   * Get the catalog's cross-metric consistency rules (may be empty).
   */
  getConsistencyRules() {
    return this.consistencyRules;
  }

  /**
   * Get the effective weight for a metric (criticality-based or override).
   */
  getEffectiveWeight(metric) {
    if (metric.weight !== null && metric.weight !== undefined) {
      return metric.weight;
    }
    return CRITICALITY_WEIGHTS[metric.criticality] || 1;
  }

  /**
   * Why a metric is left out of a run, or null when it is active. Genuine
   * non-applicability ('version', 'deployment_profile', 'extension') is
   * checked before the run's collection scope ('mode', 'source').
   * @private
   */
  _exclusionReason(metric, options = {}) {
    const {
      mode = 'standalone',
      deploymentProfile = null,
      installedExtensions = [],
      availableSources = ['sql', 'manual'],
    } = options;
    // serverVersion is the generic option (1.15.0); pgVersion stays its alias.
    const serverVersion = effectiveServerVersion(options);
    // An unregistered technology (a custom catalog loaded through fromData)
    // keeps the field every catalog understood before 1.15.0.
    const versionField = MIN_VERSION_FIELDS[this.technology] || 'min_pg_version';
    const minVersion = metric[versionField];
    if (minVersion != null && minVersion !== '' && serverVersion !== null) {
      const cmp = compareVersions(serverVersion, minVersion);
      if (cmp !== null && cmp < 0) return 'version';
    }

    if (metric.deployment_profiles) {
      if (!deploymentProfile || !metric.deployment_profiles.includes(deploymentProfile)) return 'deployment_profile';
    }

    if (metric.extension_requirement) {
      if (!installedExtensions.includes(metric.extension_requirement)) return 'extension';
    }

    if (mode === 'standalone' && metric.agent_only) return 'mode';

    // Zabbix and worker collectors provide SQL-equivalent data, so treat
    // 'sql' metrics as available when monitoring collectors are active.
    const effectiveSources = [...availableSources];
    if ((effectiveSources.includes('zabbix') || effectiveSources.includes('worker')) && !effectiveSources.includes('sql')) {
      effectiveSources.push('sql');
    }
    const hasSource = metric.sources.some(s => effectiveSources.includes(s));
    if (!hasSource) return 'source';

    return null;
  }

  /**
   * Get active metrics filtered by runtime context.
   *
   * @param {Object} options
   * @param {string} options.mode - 'standalone' or 'agent'
   * @param {number|string} [options.serverVersion] - Server version in the catalog's own format:
   *   PostgreSQL server_version_num (160004), dotted for the others ("8.0.35")
   * @param {number} [options.pgVersion] - Alias of serverVersion (kept for existing consumers)
   * @param {string} [options.deploymentProfile] - 'self-managed', 'azure-flexible', etc.
   * @param {string[]} [options.installedExtensions] - List of installed extension names
   * @param {string[]} [options.availableSources] - Available collection sources
   * @returns {Object[]} Active metric definitions
   */
  getActiveMetrics(options = {}) {
    return this.metrics.filter(metric => this._exclusionReason(metric, options) === null);
  }

  /**
   * Why a metric is left out of a run with these options, or null when it is
   * active: 'version', 'deployment_profile', 'extension' (it does not apply),
   * 'mode' or 'source' (it applies but the run's collection scope left it out).
   */
  getExclusionReason(metric, options = {}) {
    return this._exclusionReason(metric, options);
  }

  /**
   * Metrics left out only because of the run's collection scope: an evidence
   * source the run did not declare, or an agent-only metric in standalone
   * mode (1.15.0). They apply to the estate but were never assessed, unlike
   * metrics excluded for version, deployment profile or extension.
   * @param {Object} options - Same options as getActiveMetrics
   * @returns {Object[]}
   */
  getScopeExcludedMetrics(options = {}) {
    return this.metrics.filter(metric => SCOPE_EXCLUSIONS.has(this._exclusionReason(metric, options)));
  }

  /**
   * Get active metrics grouped by subcategory.
   * @returns {Map<string, Object[]>}
   */
  getActiveMetricsBySubcategory(options = {}) {
    const active = this.getActiveMetrics(options);
    const grouped = new Map();
    for (const metric of active) {
      if (!grouped.has(metric.subcategory)) grouped.set(metric.subcategory, []);
      grouped.get(metric.subcategory).push(metric);
    }
    return grouped;
  }

  /**
   * Get manual input metrics, optionally filtered by deployment profile.
   */
  getManualMetrics(deploymentProfile = null) {
    return this.metrics.filter(metric => {
      if (!metric.sources.includes('manual')) return false;
      if (metric.deployment_profiles) {
        if (!deploymentProfile || !metric.deployment_profiles.includes(deploymentProfile)) return false;
      }
      return true;
    });
  }

  /**
   * Get manual metrics grouped by pillar.
   */
  getManualMetricsByPillar(deploymentProfile = null) {
    const result = {};
    for (const pillarId of this.getPillarIds()) {
      result[pillarId] = [];
    }
    for (const metric of this.getManualMetrics(deploymentProfile)) {
      const sub = this.subcategories[metric.subcategory];
      if (sub) {
        result[sub.pillar].push(metric);
      }
    }
    return result;
  }

  /**
   * Calculate the maximum achievable score for a set of active metrics.
   */
  calculateMaxScore(activeMetrics) {
    const bySubcat = new Map();
    for (const metric of activeMetrics) {
      if (!bySubcat.has(metric.subcategory)) bySubcat.set(metric.subcategory, []);
      bySubcat.get(metric.subcategory).push(metric);
    }

    const byPillar = {};
    for (const [subcatId] of bySubcat) {
      const subcat = this.subcategories[subcatId];
      if (!subcat) continue;
      byPillar[subcat.pillar] = (byPillar[subcat.pillar] || 0) + this.subcategories[subcatId].maxPoints;
    }

    let total = 0;
    for (const pillarId of Object.keys(byPillar)) {
      const pillarDef = this.pillars[pillarId];
      total += Math.min(byPillar[pillarId], pillarDef ? pillarDef.maxPoints : 20);
    }

    return total;
  }
}

// Default singleton (PostgreSQL — backward compatible)
const catalog = new MetricCatalog('postgresql');

// Cache for other technologies
const catalogCache = new Map();
catalogCache.set('postgresql', catalog);

/**
 * Get a MetricCatalog instance for a specific technology (cached).
 * @param {string} technology
 * @returns {MetricCatalog}
 */
function getCatalog(technology = 'postgresql') {
  if (!catalogCache.has(technology)) {
    catalogCache.set(technology, new MetricCatalog(technology));
  }
  return catalogCache.get(technology);
}

module.exports = { MetricCatalog, catalog, getCatalog, CRITICALITY_WEIGHTS, SUPPORTED_TECHNOLOGIES, compareVersions, effectiveServerVersion };
