'use strict';

const path = require('path');

/**
 * Metric catalog file paths, keyed by technology.
 * Resolved relative to the data/metrics/ directory.
 */
const CATALOG_FILES = {
  postgresql: path.resolve(__dirname, '../../data/metrics/postgresql.json'),
  oracle: path.resolve(__dirname, '../../data/metrics/oracle.json'),
  mysql: path.resolve(__dirname, '../../data/metrics/mysql.json'),
  mariadb: path.resolve(__dirname, '../../data/metrics/mariadb.json'),
  mongodb: path.resolve(__dirname, '../../data/metrics/mongodb.json'),
  sqlserver: path.resolve(__dirname, '../../data/metrics/sqlserver.json'),
};

/**
 * Supported database technologies.
 */
const SUPPORTED_TECHNOLOGIES = Object.keys(CATALOG_FILES);

/**
 * Default weights assigned by metric criticality level.
 * Used when a metric has no explicit weight override.
 *
 * - critical: foundational requirement, 3x weight
 * - important: best practice, 2x weight
 * - advisory: nice-to-have, 1x weight
 */
const { SCORING_POLICY } = require('../scoring/policy');
const CRITICALITY_WEIGHTS = SCORING_POLICY.criticalityWeights;

/**
 * Name of each technology's minimum-version field on a metric (1.15.0). A
 * registry like CATALOG_FILES: it names a field and holds no scoring logic.
 * The value format is the catalog's own: PostgreSQL uses server_version_num
 * (170000), the others dotted versions ("8.0", "10.4"). Oracle and SQL Server
 * carry a generic min_version and MongoDB min_mongo_version, all empty today,
 * so only the PostgreSQL, MySQL and MariaDB filters currently remove metrics.
 */
const MIN_VERSION_FIELDS = {
  postgresql: 'min_pg_version',
  mysql: 'min_mysql_version',
  mariadb: 'min_mariadb_version',
  mongodb: 'min_mongo_version',
  oracle: 'min_version',
  sqlserver: 'min_version',
};

module.exports = { CATALOG_FILES, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS, MIN_VERSION_FIELDS };
