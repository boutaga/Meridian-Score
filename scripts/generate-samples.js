'use strict';

/**
 * Generate sample metric value sets for each technology.
 *
 * Produces two files per technology:
 * - {tech}-healthy.json: all metrics set to passing values
 * - {tech}-critical.json: critical metrics set to failing values
 *
 * Usage: node scripts/generate-samples.js
 */

const fs = require('fs');
const path = require('path');
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../src');

const OUTPUT_DIR = path.resolve(__dirname, '../data/samples');

function getPassingValue(metric) {
  const config = metric.evaluation_config || {};

  switch (metric.evaluation_type) {
    case 'boolean': {
      if (config.check === 'not_empty_or_dummy') {
        return '/usr/bin/pgbackrest --stanza=main archive-push %p';
      }
      const expected = config.pass_value !== undefined ? config.pass_value : true;
      return expected;
    }

    case 'enum': {
      const passValues = config.pass_values || [];
      return passValues.length > 0 ? passValues[0] : 'on';
    }

    case 'threshold': {
      if (config.min !== undefined && config.max !== undefined) {
        return Math.round((config.min + config.max) / 2);
      }
      if (config.max !== undefined) {
        return Math.round(config.max * 0.5);
      }
      if (config.min !== undefined) {
        return Math.round(config.min * 1.5) || config.min + 1;
      }
      return 50;
    }

    case 'range': {
      if (config.min !== undefined && config.max !== undefined) {
        return Math.round((config.min + config.max) / 2);
      }
      return 50;
    }

    default:
      return true;
  }
}

function getFailingValue(metric) {
  const config = metric.evaluation_config || {};

  switch (metric.evaluation_type) {
    case 'boolean': {
      if (config.check === 'not_empty_or_dummy') {
        return '/bin/true';
      }
      const expected = config.pass_value !== undefined ? config.pass_value : true;
      return !expected;
    }

    case 'enum':
      return 'INVALID_VALUE';

    case 'threshold': {
      if (config.max !== undefined) {
        return Math.round(config.max * 3);
      }
      if (config.min !== undefined) {
        return 0;
      }
      return 0;
    }

    case 'range': {
      if (config.max !== undefined) {
        return Math.round(config.max * 3);
      }
      return 0;
    }

    default:
      return false;
  }
}

function generateSamples(technology) {
  const catalog = getCatalog(technology);
  const healthy = {};
  const critical = {};

  for (const metric of catalog.metrics) {
    if (metric.agent_only) continue;
    if (metric.extension_requirement) continue;

    healthy[metric.legacy_name] = getPassingValue(metric);

    if (metric.criticality === 'critical') {
      critical[metric.legacy_name] = getFailingValue(metric);
    } else {
      critical[metric.legacy_name] = getPassingValue(metric);
    }
  }

  return { healthy, critical };
}

// Main
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

for (const tech of SUPPORTED_TECHNOLOGIES) {
  const { healthy, critical } = generateSamples(tech);
  const catalog = getCatalog(tech);

  const healthyData = {
    _meta: {
      technology: tech,
      scenario: 'healthy',
      description: `All ${Object.keys(healthy).length} metrics set to passing values`,
      catalogVersion: catalog.version,
      generatedAt: new Date().toISOString(),
    },
    values: healthy,
  };

  const criticalData = {
    _meta: {
      technology: tech,
      scenario: 'critical',
      description: `Critical metrics set to failing values, others passing`,
      catalogVersion: catalog.version,
      generatedAt: new Date().toISOString(),
    },
    values: critical,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${tech}-healthy.json`),
    JSON.stringify(healthyData, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${tech}-critical.json`),
    JSON.stringify(criticalData, null, 2) + '\n'
  );

  console.log(`${tech}: generated healthy (${Object.keys(healthy).length} metrics) + critical samples`);
}

console.log(`\nSamples written to ${OUTPUT_DIR}`);
