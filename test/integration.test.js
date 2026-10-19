'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ScoringEngine = require('../src/scoring/engine');
const { SUPPORTED_TECHNOLOGIES } = require('../src');
const fs = require('fs');
const path = require('path');

const SAMPLES_DIR = path.resolve(__dirname, '../data/samples');

describe('Integration: end-to-end scoring', () => {
  describe('PostgreSQL', () => {
    const engine = new ScoringEngine('postgresql');

    // 1.17.0: 100 needs every check assessed, so the agent run.
    it('healthy sample scores 100/100', () => {
      const data = require(path.join(SAMPLES_DIR, 'postgresql-healthy.json'));
      const result = engine.calculate(data.values, {
        systemFacts: data.systemFacts, workloadProfile: data.workloadProfile,
        mode: 'agent', availableSources: ['sql', 'manual', 'zabbix', 'worker'],
      });

      assert.equal(result.totalScore, 100);
      assert.equal(result.totalPercentage, 100);
      assert.equal(result.status, 'excellent');
      assert.equal(Object.keys(result.pillars).length, 5);
    });

    it('critical sample scores below 70%', () => {
      const data = require(path.join(SAMPLES_DIR, 'postgresql-critical.json'));
      const result = engine.calculate(data.values);

      assert.ok(result.totalPercentage < 70, `Expected < 70%, got ${result.totalPercentage}%`);
      assert.ok(result.allFindings.length > 0, 'Should have findings');
      assert.ok(result.recommendations.length > 0, 'Should have recommendations');
    });

    it('critical sample triggers Future-Proofing pillar zero gate', () => {
      const data = require(path.join(SAMPLES_DIR, 'postgresql-critical.json'));
      const result = engine.calculate(data.values);

      assert.equal(result.pillars.futureproof.score, 0, 'Future-Proofing should be zeroed');
    });
  });

  describe('all technologies produce valid output', () => {
    for (const tech of SUPPORTED_TECHNOLOGIES) {
      it(`${tech} healthy sample produces valid score structure`, () => {
        const samplePath = path.join(SAMPLES_DIR, `${tech}-healthy.json`);
        if (!fs.existsSync(samplePath)) return; // skip if sample not generated

        const engine = new ScoringEngine(tech);
        const data = require(samplePath);
        const result = engine.calculate(data.values);

        // Structure checks
        assert.ok(typeof result.totalScore === 'number');
        assert.ok(typeof result.totalPercentage === 'number');
        assert.ok(result.totalScore >= 0 && result.totalScore <= 100);
        assert.ok(['excellent', 'good', 'needs_improvement', 'critical'].includes(result.status));
        assert.equal(Object.keys(result.pillars).length, 5);
        assert.ok(Array.isArray(result.allMetrics));
        assert.ok(Array.isArray(result.allFindings));
        assert.ok(Array.isArray(result.recommendations));

        // Each pillar has required fields
        for (const [id, p] of Object.entries(result.pillars)) {
          assert.ok(typeof p.name === 'string', `${id} has name`);
          assert.ok(typeof p.score === 'number', `${id} has score`);
          assert.ok(typeof p.maxScore === 'number', `${id} has maxScore`);
          assert.ok(typeof p.percentage === 'number', `${id} has percentage`);
          assert.ok(typeof p.status === 'string', `${id} has status`);
        }
      });

      it(`${tech} critical sample produces lower scores`, () => {
        const healthyPath = path.join(SAMPLES_DIR, `${tech}-healthy.json`);
        const criticalPath = path.join(SAMPLES_DIR, `${tech}-critical.json`);
        if (!fs.existsSync(healthyPath) || !fs.existsSync(criticalPath)) return;

        const engine = new ScoringEngine(tech);
        const healthy = require(healthyPath);
        const critical = require(criticalPath);

        const hResult = engine.calculate(healthy.values);
        const cResult = engine.calculate(critical.values);

        assert.ok(cResult.totalScore < hResult.totalScore,
          `${tech}: critical (${cResult.totalScore}) should be less than healthy (${hResult.totalScore})`);
      });
    }
  });
});
