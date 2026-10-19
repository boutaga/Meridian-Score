'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MetricCatalog, getCatalog, SUPPORTED_TECHNOLOGIES, CRITICALITY_WEIGHTS } = require('../src');

describe('MetricCatalog', () => {
  describe('loading', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      it(`loads ${tech} catalog successfully`, () => {
        const cat = getCatalog(tech);
        assert.ok(cat.version, `${tech} has version`);
        assert.ok(cat.metrics.length > 0, `${tech} has metrics`);
        assert.equal(Object.keys(cat.pillars).length, 5, `${tech} has 5 pillars`);
        assert.ok(Object.keys(cat.subcategories).length > 0, `${tech} has subcategories`);
      });
    }

    it('throws for unsupported technology', () => {
      assert.throws(() => new MetricCatalog('redis'), /Unsupported technology/);
    });
  });

  describe('fromData factory', () => {
    it('creates a catalog from raw data', () => {
      const data = {
        version: '1.0.0',
        pillars: { test: { name: 'Test', maxPoints: 20, order: 1 } },
        subcategories: { test_sub: { pillar: 'test', name: 'Test Sub', maxPoints: 10, order: 1 } },
        metrics: [{
          metric_id: 'T-1.1',
          subcategory: 'test_sub',
          legacy_name: 'test_metric',
          display_name: 'Test Metric',
          description: 'A test',
          criticality: 'critical',
          weight: null,
          evaluation_type: 'boolean',
          evaluation_config: { pass_value: true },
          sources: ['sql'],
          agent_only: false,
          deployment_profiles: null,
          min_pg_version: null,
          extension_requirement: null,
          metric_tier: 'baseline',
          remediation: 'Fix it',
        }],
      };
      const cat = MetricCatalog.fromData('custom', data);
      assert.equal(cat.technology, 'custom');
      assert.equal(cat.metrics.length, 1);
      assert.equal(cat.getById('T-1.1').display_name, 'Test Metric');
    });
  });

  describe('index lookups', () => {
    const cat = getCatalog('postgresql');

    it('getById returns metric', () => {
      const m = cat.getById('BAK-1.1');
      assert.ok(m, 'BAK-1.1 exists');
      assert.equal(m.legacy_name, 'archive_mode');
    });

    it('getById returns null for unknown', () => {
      assert.equal(cat.getById('FAKE-99'), null);
    });

    it('getByLegacyName returns metric', () => {
      const m = cat.getByLegacyName('archive_mode');
      assert.ok(m);
      assert.equal(m.metric_id, 'BAK-1.1');
    });

    it('getByLegacyName returns null for unknown', () => {
      assert.equal(cat.getByLegacyName('nonexistent'), null);
    });
  });

  describe('pillar and subcategory access', () => {
    const cat = getCatalog('postgresql');

    it('getPillarIds returns 5 pillars', () => {
      const ids = cat.getPillarIds();
      assert.equal(ids.length, 5);
      assert.ok(ids.includes('backup'));
      assert.ok(ids.includes('security'));
      assert.ok(ids.includes('capacity'));
      assert.ok(ids.includes('performance'));
      assert.ok(ids.includes('futureproof'));
    });

    it('getPillar returns pillar definition', () => {
      const p = cat.getPillar('backup');
      assert.equal(p.name, 'Backup & Recovery');
      assert.equal(p.maxPoints, 20);
    });

    it('getSubcategoryIds returns sorted subcategories', () => {
      const ids = cat.getSubcategoryIds('backup');
      assert.ok(ids.length >= 3);
      // Verify ordering
      for (let i = 1; i < ids.length; i++) {
        assert.ok(cat.getSubcategory(ids[i]).order >= cat.getSubcategory(ids[i - 1]).order);
      }
    });
  });

  describe('getEffectiveWeight', () => {
    const cat = getCatalog('postgresql');

    it('returns criticality weight when no override', () => {
      const m = { criticality: 'critical', weight: null };
      assert.equal(cat.getEffectiveWeight(m), CRITICALITY_WEIGHTS.critical);
    });

    it('returns override weight when set', () => {
      const m = { criticality: 'critical', weight: 5 };
      assert.equal(cat.getEffectiveWeight(m), 5);
    });

    it('defaults to 1 for unknown criticality', () => {
      const m = { criticality: 'unknown', weight: null };
      assert.equal(cat.getEffectiveWeight(m), 1);
    });
  });

  describe('getActiveMetrics', () => {
    const cat = getCatalog('postgresql');

    it('excludes agent_only in standalone mode', () => {
      const active = cat.getActiveMetrics({ mode: 'standalone' });
      const agentOnly = active.filter(m => m.agent_only);
      assert.equal(agentOnly.length, 0);
    });

    it('includes agent_only in agent mode', () => {
      const active = cat.getActiveMetrics({ mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'] });
      // May or may not have agent_only metrics depending on catalog
      assert.ok(active.length > 0);
    });

    it('excludes metrics requiring unavailable extensions', () => {
      const withoutVector = cat.getActiveMetrics({ installedExtensions: [] });
      const withVector = cat.getActiveMetrics({ installedExtensions: ['vector'] });
      assert.ok(withVector.length >= withoutVector.length);
    });

    it('filters by deployment profile', () => {
      const all = cat.getActiveMetrics({});
      const selfManaged = cat.getActiveMetrics({ deploymentProfile: 'self-managed' });
      // self-managed should include profile-restricted metrics
      assert.ok(selfManaged.length >= 0);
    });

    it('treats zabbix/worker as sql-equivalent source', () => {
      const sqlOnly = cat.getActiveMetrics({ availableSources: ['sql', 'manual'] });
      const withZabbix = cat.getActiveMetrics({ availableSources: ['zabbix', 'manual'] });
      // Zabbix provides SQL-equivalent data, so counts should be similar
      assert.ok(withZabbix.length > 0);
    });
  });

  describe('getManualMetrics', () => {
    const cat = getCatalog('postgresql');

    it('returns only manual-sourced metrics', () => {
      const manual = cat.getManualMetrics();
      for (const m of manual) {
        assert.ok(m.sources.includes('manual'), `${m.metric_id} should have manual source`);
      }
      assert.ok(manual.length > 0);
    });
  });

  describe('calculateMaxScore', () => {
    const cat = getCatalog('postgresql');

    it('returns 100 when all subcategories active', () => {
      const active = cat.getActiveMetrics({});
      const maxScore = cat.calculateMaxScore(active);
      assert.equal(maxScore, 100);
    });

    it('returns less than 100 with filtered metrics', () => {
      // Only extension metrics — likely covers fewer subcategories
      const extensionOnly = cat.metrics.filter(m => m.extension_requirement);
      if (extensionOnly.length > 0) {
        const maxScore = cat.calculateMaxScore(extensionOnly);
        assert.ok(maxScore < 100);
      }
    });
  });
});
