/* Scoring Simulator - Client-side */

// v1.6.0 — Render the score_movement annotation produced by a Phase-2
// consistency rule. Returns an HTML fragment (or '') describing how the rule
// moved the score, so the operator can see "this rule reduced Caching by 1 pt".
function renderScoreMovement(sm) {
  if (!sm || !sm.type) return '';
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const prior = round(sm.prior_score);
  const next  = round(sm.new_score);
  let summary;
  if (sm.type === 'subcategory_deduction') {
    const delta = round(sm.applied);
    summary = `Deducted ${delta} pt${delta === 1 ? '' : 's'} from ${sm.target} (${prior} → ${next})`;
  } else if (sm.type === 'subcategory_cap') {
    summary = `Capped ${sm.target} at ${sm.cap_pct}% = ${round(sm.cap_points)} pts (${prior} → ${next})`;
  } else if (sm.type === 'pillar_deduction') {
    const delta = round(sm.applied);
    summary = `Deducted ${delta} pt${delta === 1 ? '' : 's'} from ${sm.target} pillar (${prior} → ${next})`;
  } else if (sm.type === 'metric_zero') {
    const delta = round(sm.applied);
    summary = `Zeroed ${sm.target} (−${delta} of ${round(sm.metric_max)} pts) — ${sm.subcategory} ${prior} → ${next}`;
  } else {
    return '';
  }
  return `<p class="finding-score-movement"><span class="badge badge-rule">score</span> ${summary}</p>`;
}

// v1.8.0 — A finding carries either a singular score_movement (legacy rules)
// or a score_movements array (multi-adjustment rules). Render whichever is set.
function renderScoreMovements(f) {
  if (Array.isArray(f.score_movements)) {
    return f.score_movements.map(renderScoreMovement).join('');
  }
  return renderScoreMovement(f.score_movement);
}

// 1.15.0: unresolved critical requirements, shown beside the score because the
// numeric band alone can read "excellent" over a failed critical check.
// Mirrors the server-side EJS block so it survives a client recalc.
function renderDisposition(d) {
  if (!d || d.state !== 'critical_unresolved') return '';
  const reasonText = (i) => i.reason === 'missing' ? 'not provided'
    : i.reason === 'invalidated' ? 'invalidated by ' + (i.rules || []).join(', ')
    : i.reason === 'rule' ? 'cross-metric rule' : 'failed';
  const items = d.items.map(i => `<li><code>${escapeHtml(i.id)}</code> ${escapeHtml(i.name)}: ${escapeHtml(reasonText(i))}</li>`).join('');
  return `
    <div class="score-disposition" role="status">
      <div class="disposition-headline">Critical requirement unresolved (${d.items.length})</div>
      <ul>${items}</ul>
    </div>`;
}

// 1.16.0 (DEC-029): "target not reached" names the required checks missed, the
// same list the engine returns, so the simulator and Altimeter flag the same.
function renderTargetGap(data) {
  const missed = data.requiredMissed || [];
  if (data.onTarget || missed.length === 0) return '';
  const reasonText = { missing: 'not provided', invalidated: 'invalidated by a rule', partial: 'partial credit', failed: 'failed', rule: 'this rule took required points' };
  // 1.17.0: a required check outside the run's collection scope is not assessed.
  const why = (i) => (i.reason === 'missing' && i.outOfScope ? "not assessed, outside this run's collection scope" : reasonText[i.reason] || i.reason);
  const items = missed.map(i => `<li><code>${escapeHtml(i.id)}</code> ${escapeHtml(i.name)}: ${escapeHtml(why(i))}</li>`).join('');
  return `
    <div class="score-target-gap" role="status">
      <div class="disposition-headline">Target not reached: ${missed.length} required check${missed.length === 1 ? '' : 's'} missed</div>
      <ul>${items}</ul>
    </div>`;
}

// 1.15.0: the status label is never shown without the disposition (DEC-018).
function dispositionSuffix(d) {
  if (!d) return '';
  return d.state === 'critical_unresolved'
    ? ` <span class="pillar-gate-chip" title="${escapeHtml(d.items.map(i => i.id).join(', '))}">critical requirement unresolved (${d.items.length})</span>`
    : ' · no open critical requirement';
}

// 1.15.0: the coverage percentage only counts metrics that were in scope, so
// say when the run left applicable metrics out (their collector did not run).
function renderCollectionScope(cov) {
  if (cov.collectionScope !== 'partial' || !cov.outOfScope) return '';
  const o = cov.outOfScope;
  const crit = o.critical.length ? ` Critical among them: ${escapeHtml(o.critical.join(', '))}.` : '';
  const why = [];
  if (o.byReason && o.byReason.mode) why.push(`${o.byReason.mode} agent-only in this standalone run`);
  if (o.byReason && o.byReason.source) why.push(`${o.byReason.source} from a source this run did not declare`);
  return `<div class="coverage-scope" title="${escapeHtml(o.metricIds.join(', '))}">Partial collection scope, ${o.count} applicable metrics never assessed: ${why.join('; ')}.${crit}</div>`;
}

// v1.4.0 — Coverage badge: how much of the applicable catalog was assessed.
// Mirrors the server-side EJS block so it survives a client recalc.
function renderCoverage(cov) {
  if (!cov) return '';
  const c = cov.counts || {};
  return `
    <div class="score-coverage">
      <div class="coverage-headline">
        <span class="coverage-pct">${cov.percentage}%</span> catalog coverage
        <span class="text-muted">(${cov.assessedWeight}/${cov.applicableWeight} pts assessed)</span>
      </div>
      ${renderCollectionScope(cov)}
      <div class="coverage-counts">
        <span title="metrics scored">✓ ${c.scored} scored</span>
        <span class="cov-crit" title="missing critical metrics">✗ ${c.missingCritical} crit</span>
        <span title="missing non-critical metrics">${c.missingNonCritical} non-crit</span>
        <span title="not applicable">${c.notApplicable} n/a</span>
        <span title="license-excluded">${c.licenseExcluded} lic</span>
      </div>
    </div>`;
}

// v1.4.0 — Assessment context: the conditions the score was produced under.
function renderContext(ctx) {
  if (!ctx) return '';
  const licensed = (ctx.licensedOptions && ctx.licensedOptions.length) ? ctx.licensedOptions.join(', ') : '—';
  const facts = (ctx.systemFactsProvided && ctx.systemFactsProvided.length) ? ctx.systemFactsProvided.join(', ') : '—';
  const deployment = ctx.deploymentProfile ? `<dt>Deployment</dt><dd>${ctx.deploymentProfile}</dd>` : '';
  return `
    <details class="context-block">
      <summary>Assessment context — engine ${ctx.engineVersion} · catalog ${ctx.catalogVersion}</summary>
      <dl>
        <dt>Technology</dt><dd>${ctx.technology}</dd>
        <dt>Mode</dt><dd>${ctx.mode}</dd>
        <dt>Workload</dt><dd>${ctx.workloadProfile}</dd>
        ${deployment}
        <dt>Licensed</dt><dd>${licensed}</dd>
        <dt>Facts provided</dt><dd>${facts}</dd>
        ${ctx.fingerprint ? `<dt>Rules code</dt><dd><code title="${htmlEsc(ctx.fingerprint.rules)}">${htmlEsc(ctx.fingerprint.rulesShort)}</code></dd>
        <dt>Declarations code</dt><dd><code title="${htmlEsc(ctx.fingerprint.declarations)}">${htmlEsc(ctx.fingerprint.declarationsShort)}</code></dd>` : ''}
      </dl>
    </details>`;
}

function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// v1.5.0 — Maturity ladder ("next rung" advisor). Renders each declared target
// grouped by pillar with its current state, a clickable rung ladder (per-rung Δ
// vs current + coherence), and the recommended next step. One renderer for both
// first paint (window.__nextRungs) and recalc (data.nextRungs), so the two never
// drift. The ladder lives outside #scoreResults; clicking a rung reuses the
// existing .target-chip declare+recalc path.
function renderMaturityLadder(targets) {
  const host = document.getElementById('maturityLadder');
  if (!host) return;
  if (!Array.isArray(targets) || !targets.length) { host.innerHTML = ''; return; }

  const honored = targets.filter(t => t.state === 'honored').length;
  const gains = targets.filter(t => t.recommendation && (t.recommendation.kind === 'gain' || t.recommendation.kind === 'fix')).length;
  const reach = targets.filter(t => t.recommendation && t.recommendation.kind === 'aspiration').length;
  const tally = [`${honored} honored`, gains ? `${gains} with a gain` : null, reach ? `${reach} to reach for` : null].filter(Boolean).join(' · ');

  // Group by pillar, preserving first-seen order.
  const groups = [];
  const idx = new Map();
  for (const t of targets) {
    if (!idx.has(t.pillarName)) { idx.set(t.pillarName, groups.length); groups.push({ name: t.pillarName, items: [] }); }
    groups[idx.get(t.pillarName)].items.push(t);
  }

  let html = `<h2 class="ml-title">Maturity ladder <span class="ml-tally">${htmlEsc(tally)}</span></h2>
    <p class="ml-help">Declared targets vs the evidence. A declaration never switches a check off: it sets the target score, the points of the checks it requires. A rung only costs points when it's incoherent with what you've collected. Click a rung to declare it.</p>`;

  for (const g of groups) {
    html += `<div class="ml-pillar"><h3 class="ml-pillar-name">${htmlEsc(g.name)}</h3>`;
    for (const t of g.items) {
      const STATE_UI = {
        honored: { cls: 'state-honored', label: '✓ honored' },
        invalidated: { cls: 'state-zeroed', label: '✗ invalidated' },
        unmet: { cls: 'state-zeroed', label: '✗ not met' },
        undeclared: { cls: 'state-none', label: 'not declared' },
      };
      const st = STATE_UI[t.state] || STATE_UI.undeclared;
      const stateClass = st.cls;
      const stateLabel = st.label;
      const currentTxt = t.current != null ? ` <span class="ml-current">${htmlEsc(t.current)}</span>` : '';
      const chips = t.rungs.map(r => {
        const isCurrent = t.current != null && String(t.current) === String(r.value);
        const cls = ['target-chip', 'ml-chip', r.coherent ? 'ml-coherent' : 'ml-incoherent', isCurrent ? 'is-current' : ''].filter(Boolean).join(' ');
        const gain = (r.coherent && r.delta > 0) ? ` <span class="ml-delta ml-gain">+${r.delta}</span>` : '';
        const tgt = r.targetDelta ? ` <span class="ml-delta ml-target">target ${r.targetDelta > 0 ? '+' : ''}${r.targetDelta}</span>` : '';
        const coherence = r.coherent ? 'coherent with current evidence' : ('needs: ' + (r.evidence || 'more evidence'));
        const title = r.targetDelta ? `${coherence}; moves the target by ${r.targetDelta}` : coherence;
        return `<button type="button" class="${cls}" data-metric="${htmlEsc(t.legacy_name)}" data-value="${htmlEsc(r.value)}" title="${htmlEsc(title)}">${htmlEsc(r.value)}${gain}${tgt}</button>`;
      }).join('');
      html += `<div class="ml-target" data-target="${htmlEsc(t.legacy_name)}">
        <div class="ml-target-head">
          <span class="ml-target-name">${htmlEsc(t.display_name)}</span>
          <code class="metric-id">${htmlEsc(t.metric_id)}</code>
          <span class="target-state ${stateClass}">${stateLabel}${currentTxt}</span>
        </div>
        <div class="ml-rungs">${chips}</div>
        ${renderMlNext(t)}
      </div>`;
    }
    html += '</div>';
  }
  host.innerHTML = html;
}

// The recommended next step for one target, from its server-computed recommendation.
function renderMlNext(t) {
  const rec = t.recommendation;
  if (!rec) {
    return t.state === 'honored' ? '<p class="ml-next ml-top">✓ fully coherent — top of the ladder</p>' : '';
  }
  if (rec.kind === 'gain') {
    return `<p class="ml-next ml-reach">→ next: declare <b>${htmlEsc(rec.value)}</b> <span class="ml-delta ml-gain">+${rec.delta}</span></p>`;
  }
  if (rec.kind === 'fix') {
    const honor = t.currentEvidence ? ` <span class="ml-or">or honor <b>${htmlEsc(t.current)}</b>: ${htmlEsc(t.currentEvidence)}</span>` : '';
    const lower = rec.targetDelta < 0
      ? ` <span class="ml-or">(lowers your target by ${htmlEsc(-rec.targetDelta)})</span>` : '';
    const gain = rec.delta > 0 ? ` <span class="ml-delta ml-gain">+${rec.delta}</span>` : '';
    return `<p class="ml-next ml-fix">→ a declaration your evidence supports: <b>${htmlEsc(rec.value)}</b>${gain}${lower}${honor}</p>`;
  }
  const needs = rec.evidence ? ` — needs: ${htmlEsc(rec.evidence)}` : '';
  return `<p class="ml-next ml-aspire">→ reach for <b>${htmlEsc(rec.value)}</b>${needs}</p>`;
}

// Metric detail modal
function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function copyAnchor(btn) {
  const pre = btn.parentElement.querySelector('pre');
  if (!pre) return;
  const text = pre.textContent;
  const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
  else done();
}

// Simulator 2.0 — guided metric card: what is checked, how it is measured,
// how it scores. Everything is computed server-side from the catalog and the
// scoring policy (see routes/metrics.js detail API); this only renders.
function showMetricDetail(tech, metricId) {
  fetch(`/metrics/${tech}/detail/${metricId}`)
    .then(r => r.json())
    .then(m => {
      const e = escapeHtml;
      const badges = [
        `<span class="badge badge-${e(m.criticality)}">${e(m.criticality)}</span>`,
        m.derived ? '<span class="badge badge-derived">Derived</span>' : '',
        m.gate_scope === 'pillar' ? '<span class="badge badge-gate">pillar gate</span>' : '',
        m.license_requirement ? `<span class="badge badge-license">${e(m.license_requirement)}</span>` : '',
      ].join(' ');

      const what = `
        <section class="card-section">
          <h3><span class="step">1</span>What is checked</h3>
          <p>${e(m.description || 'No description')}</p>
          <dl class="card-kv">
            <dt>Passes when</dt><dd>${e(m._criteriaText || '')}${(m.evaluation_type === 'threshold' || m.evaluation_type === 'range') && m._partialCreditText ? ` <span class="text-muted">(${e(m._partialCreditText)})</span>` : ''}</dd>
            <dt>Type</dt><dd>${e(m.evaluation_type)}</dd>
            ${m.remediation ? `<dt>Remediation</dt><dd>${e(m.remediation)}</dd>` : ''}
          </dl>
        </section>`;

      const anchor = m.technical_anchor;
      const measured = `
        <section class="card-section">
          <h3><span class="step">2</span>How it is measured</h3>
          <dl class="card-kv">
            <dt>Sources</dt><dd>${(m.sources || []).map(s => `<span class="badge badge-source badge-source-${e(s)} badge-sm">${e(s)}</span>`).join(' ')}${m.agent_only ? ' <span class="text-muted">(agent only)</span>' : ''}</dd>
            ${m._derivedExpression ? `<dt>Formula</dt><dd><code>${e(m._derivedExpression)}</code><br><span class="text-muted">inputs: ${e(((m.derived_from || {}).inputs || []).join(', '))}</span></dd>` : ''}
            ${m._appliesWhenText ? `<dt>Applies when</dt><dd>${e(m._appliesWhenText)}</dd>` : ''}
            ${m._optionalWhenText ? `<dt>Not required when</dt><dd>${e(m._optionalWhenText)} (it still counts, but leaves the target and never gates)</dd>` : ''}
            ${m.license_requirement ? `<dt>License</dt><dd>${e(m.license_requirement)}</dd>` : ''}
            ${m.extension_requirement ? `<dt>Extension</dt><dd>${e(m.extension_requirement)}</dd>` : ''}
            ${m.min_pg_version || m.min_version ? `<dt>Minimum version</dt><dd>${e(m.min_pg_version || m.min_version)}</dd>` : ''}
            ${m.deployment_profiles ? `<dt>Profiles</dt><dd>${e(m.deployment_profiles.join(', '))}</dd>` : ''}
          </dl>
          ${anchor ? `<p>${e(anchor.summary)}</p><div class="anchor-box"><button type="button" class="btn btn-secondary btn-sm anchor-copy" onclick="copyAnchor(this)">Copy</button><pre><code>${e(anchor.query)}</code></pre></div>`
                   : `<p class="text-muted">No technical anchor recorded yet${m.derived ? ' (engine-computed)' : m.sources && m.sources.length === 1 && m.sources[0] === 'manual' ? ' (manual attestation)' : ''}.</p>`}
        </section>`;

      const rules = (m._referencingRules || []).map(r => `
        <div class="rule-ref">
          <span class="badge badge-${r.severity === 'critical' ? 'critical' : r.severity === 'warning' ? 'warning' : 'info'} badge-sm">${e(r.severity)}</span>
          <a href="/metrics/${e(tech)}/rules#${e(r.rule_id)}"><code>${e(r.rule_id)}</code></a>
          <span>${e(r.title)}</span>
          <span class="adj">${e(r.adjustment)}</span>
        </div>`).join('');
      const scores = `
        <section class="card-section">
          <h3><span class="step">3</span>How it scores</h3>
          <dl class="card-kv">
            <dt>Weight</dt><dd>${e(m.criticality)} (${e(m._effectiveWeight)}x)</dd>
            <dt>Worth</dt><dd>${e(m._pointsShare)} of the ${e(m._subcategoryMaxPoints)} ${e(m._subcategoryName)} points (weight pool ${e(m._subcategoryPool)})</dd>
          </dl>
          <p class="gate-note">${e(m._gateEffect || '')}${m._optionalWhenText ? e(` Not when your declared targets do not require it (${m._optionalWhenText}): then it only loses its own points.`) : ''}</p>
          ${m.rationale ? `<p class="rationale"><strong>Why this threshold.</strong> ${e(m.rationale)}</p>` : ''}
          ${rules ? `<h4 style="margin-top:12px">Rules that reference this metric</h4>${rules}` : '<p class="text-muted" style="margin-top:12px">No consistency rule references this metric.</p>'}
        </section>`;

      document.getElementById('metricDetail').innerHTML = `
        <div class="card-title-row"><h2>${e(m.display_name)}</h2>${badges}</div>
        <p class="card-ids"><code>${e(m.metric_id)}</code> <code>${e(m.legacy_name)}</code> <span class="text-muted">${e(m._pillarName)} / ${e(m._subcategoryName)}</span></p>
        ${what}${measured}${scores}`;
      const modal = document.getElementById('metricModal');
      modal.style.display = 'flex';
      modal.querySelector('.drawer-panel, .modal-content').scrollTop = 0;
    });
}

function closeModal() {
  document.getElementById('metricModal').style.display = 'none';
}

// Close the drawer on backdrop click or Escape
document.addEventListener('click', e => {
  if (e.target.id === 'metricModal') closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('metricModal');
    if (modal && modal.style.display !== 'none') closeModal();
  }
});

// Simulator: toggle pillar sections
function togglePillar(el) {
  const content = el.nextElementSibling;
  const icon = el.querySelector('.toggle-icon');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.textContent = '-';
  } else {
    content.style.display = 'none';
    icon.textContent = '+';
  }
}

// Simulator: recalculate
let recalcTimeout;
function recalculate() {
  const form = document.getElementById('simulatorForm');
  if (!form) return;

  const tech = window.location.pathname.split('/')[2];
  const formData = new FormData(form);
  const values = {};
  for (const [key, val] of formData.entries()) {
    if (val !== '') values[key] = val;
  }

  // Collect simulator-level context: workload profile + system facts.
  // Convert GB inputs to kB for the engine; drop empties.
  const profileEl = document.getElementById('workloadProfile');
  const workloadProfile = profileEl ? profileEl.value : 'mixed';
  const ramGbEl = document.getElementById('sysRamGb');
  const cpuEl = document.getElementById('sysCpu');
  const storageGbEl = document.getElementById('sysStorageGb');
  const systemFacts = {};
  if (ramGbEl && ramGbEl.value !== '') {
    const ramGb = parseFloat(ramGbEl.value);
    if (!isNaN(ramGb) && ramGb > 0) systemFacts.ram_kb = ramGb * 1024 * 1024;
  }
  if (cpuEl && cpuEl.value !== '') {
    const cpu = parseFloat(cpuEl.value);
    if (!isNaN(cpu) && cpu > 0) systemFacts.cpu_count = cpu;
  }
  if (storageGbEl && storageGbEl.value !== '') {
    const sGb = parseFloat(storageGbEl.value);
    if (!isNaN(sGb) && sGb > 0) systemFacts.storage_size_kb = sGb * 1024 * 1024;
  }

  // edition (v1.8.0 string fact): drives enterprise_edition auto-derive + OR-CR-SECPOST-1.
  const editionEl = document.getElementById('sysEdition');
  if (editionEl && editionEl.value) systemFacts.edition = editionEl.value;

  // Licensed options (v1.9.0): the packs/options the estate owns. Metrics whose
  // license_requirement isn't owned become not-applicable (no penalty).
  const licensedOptions = Array.from(document.querySelectorAll('.license-opt:checked')).map(el => el.value);
  const licenseCountEl = document.getElementById('licenseCount');
  if (licenseCountEl) licenseCountEl.textContent = licensedOptions.length;

  fetch(`/simulate/${tech}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values, systemFacts, workloadProfile, licensedOptions }),
  })
    .then(r => {
      if (!r.ok) throw new Error(`calculate returned HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      updateScoreDisplay(data);
      const st = document.getElementById('payloadStatus');
      if (st && /Scoring\.\.\./.test(st.textContent)) st.textContent = st.textContent.replace('Scoring...', 'scored.');
    })
    .catch(err => {
      const st = document.getElementById('payloadStatus');
      if (st) st.textContent = `Scoring failed: ${err.message}`;
      const box = document.getElementById('scoreResults');
      if (box) box.insertAdjacentHTML('afterbegin', `<p class="payload-error">Scoring failed: ${escapeHtml(err.message)}</p>`);
    });
}

function updateScoreDisplay(data) {
  const container = document.getElementById('scoreResults');
  if (!container) return;

  const statusClass = 'status-' + data.status;
  let html = `
    <div class="total-score ${statusClass}">
      <div class="score-value">${data.totalScore}</div>
      <div class="score-max">/ ${data.totalMaxScore}</div>
      <div class="score-pct">target ${data.targetScore} · ${data.targetAttainment}% reached${data.pointsNotAssessed > 0 ? ` · ${data.pointsNotAssessed} not assessed` : ''}</div>
      <div class="score-status">${data.status.replace('_', ' ')}</div>
    </div>
    ${renderDisposition(data.disposition)}
    ${renderTargetGap(data)}
    ${renderCoverage(data.coverage)}
    <div class="pillar-scores">
  `;

  for (const [id, p] of Object.entries(data.pillars)) {
    html += `
      <div class="pillar-score-row">
        <div class="pillar-score-name">${p.name}${p.criticalGated ? ' <span class="pillar-gate-chip" title="A critical metric in this pillar hard-failed or is missing. The pillar is capped at 60% until it is fixed (criticality gate).">critical gate</span>' : ''}</div>
        <div class="pillar-score-bar-container">
          <div class="pillar-score-bar status-bg-${p.status}" style="width:${p.percentage}%"></div>
        </div>
        <div class="pillar-score-value">${p.score}/${p.maxScore} <span class="text-muted">target ${p.target} · ${p.targetAttainment}%</span></div>
      </div>
    `;
  }
  html += '</div>';

  html += renderContext(data.context);

  html += `<h3>Findings (${data.findingsCount})</h3>`;
  html += '<div class="findings-list">';
  if (data.findings && data.findings.length > 0) {
    for (const f of data.findings) {
      const ruleBadge = f.kind === 'consistency' ? `<span class="badge badge-rule">rule ${f.rule_id}</span>` : '';
      const desc = f.kind === 'consistency' && f.description ? `<p class="finding-description">${f.description}</p>` : '';
      const rem = f.remediation ? `<p class="finding-remediation">${f.remediation}</p>` : '';
      const movement = renderScoreMovements(f);
      html += `
        <div class="finding finding-${f.severity}">
          <span class="badge badge-${f.severity}">${f.severity}</span>
          ${ruleBadge}
          <strong>${f.title}</strong>
          ${movement}
          ${desc}
          ${rem}
        </div>
      `;
    }
  } else {
    html += '<p class="text-muted">No critical or warning findings.</p>';
  }
  html += '</div>';

  // v1.8.0/v1.9.0 — metrics excluded by applies_when (collected state) OR license
  // (entitlement), split by exclusion_reason. Both carry no points and no gate.
  if (data.notApplicable && data.notApplicable.length > 0) {
    const byLicense = data.notApplicable.filter(m => m.exclusion_reason === 'license');
    const byState = data.notApplicable.filter(m => m.exclusion_reason !== 'license');
    html += `<h3>Not applicable (${data.notApplicable.length})</h3>`;
    if (byLicense.length > 0) {
      html += `<p class="text-muted na-license"><strong>Not licensed (${byLicense.length}):</strong> ${byLicense.map(m => `${m.display_name}${m.license_requirement ? ` <span class="badge badge-license badge-sm">${m.license_requirement}</span>` : ''}`).join(', ')}</p>`;
    }
    if (byState.length > 0) {
      html += `<p class="text-muted na-state">Excluded by their <code>applies_when</code> condition: ${byState.map(m => m.display_name).join(', ')}</p>`;
    }
  }

  html += '<h3>Recommendations</h3>';
  html += '<div class="recommendations-list">';
  if (data.recommendations.length > 0) {
    for (const r of data.recommendations) {
      const badge = r.priority === 'high' ? 'critical' : r.priority === 'medium' ? 'important' : 'advisory';
      html += `
        <div class="recommendation">
          <span class="badge badge-${badge}">${r.priority}</span>
          <strong>${r.title}</strong>${r.aboveTarget ? ' <span class="badge badge-sm">above your target</span>' : ''}
          <p>${r.action}</p>
        </div>
      `;
    }
  } else {
    html += '<p class="text-muted">No recommendations.</p>';
  }
  html += '</div>';

  container.innerHTML = html;

  // 1.16.0: tag the form rows of checks the declared targets do not require.
  const notRequired = new Set((data.metrics || []).filter(m => m.applicable && m.required === false).map(m => m.name));
  document.querySelectorAll('#simulatorForm .metric-input-row[data-metric]').forEach(row => {
    const label = row.querySelector('.metric-label');
    const old = row.querySelector('.not-required-tag');
    if (old) old.remove();
    if (label && notRequired.has(row.dataset.metric)) {
      label.insertAdjacentHTML('beforebegin', '<span class="badge badge-sm not-required-tag" title="Your declared targets do not require this check: it still earns or loses its points, but leaves the target and never gates.">not required by your targets</span>');
    }
  });

  // The maturity ladder lives outside #scoreResults; re-render it from the fresh
  // next-rung advisor data so states, rung deltas, and steps move with the score.
  renderMaturityLadder(data.nextRungs);
}

// Declared-targets ladder: clicking a rung declares that value on the matching
// metric <select> in the form, highlights it, and triggers a recalc so the
// score moves live. Reuses the existing form + recalculate() path.
document.addEventListener('click', e => {
  const chip = e.target.closest('.target-chip');
  if (!chip) return;
  const metric = chip.getAttribute('data-metric');
  const value = chip.getAttribute('data-value');
  const select = document.querySelector(`#simulatorForm [name="${metric}"]`);
  if (select) select.value = value;
  const row = chip.closest('.ml-target');
  if (row) row.querySelectorAll('.target-chip').forEach(c => c.classList.toggle('is-current', c === chip));
  recalculate();
});

// v1.5.0 — first paint of the maturity ladder from the server-injected seed
// (app.js loads at end of body, so the #maturityLadder element already exists).
if (typeof window !== 'undefined' && window.__nextRungs) {
  renderMaturityLadder(window.__nextRungs);
}

// Debounced auto-recalculate on input change (metric values and simulator context).
document.addEventListener('change', e => {
  if (e.target.classList.contains('metric-input') || e.target.classList.contains('context-input')) {
    clearTimeout(recalcTimeout);
    recalcTimeout = setTimeout(recalculate, 300);
  }
});
document.addEventListener('input', e => {
  if (e.target.classList.contains('context-input')) {
    clearTimeout(recalcTimeout);
    recalcTimeout = setTimeout(recalculate, 500);
  }
});

// Impact analyzer: validate pillar sum
function validatePillarSum(pillarId) {
  const inputs = document.querySelectorAll(`.subcat-points[data-pillar="${pillarId}"]`);
  let sum = 0;
  inputs.forEach(i => sum += parseFloat(i.value) || 0);

  const validationDiv = document.getElementById('pillarValidation');
  if (!validationDiv) return;
  const existing = validationDiv.querySelector(`[data-pillar="${pillarId}"]`);
  if (existing) existing.remove();

  if (Math.abs(sum - 20) > 0.01) {
    const el = document.createElement('div');
    el.className = 'validation-error';
    el.dataset.pillar = pillarId;
    el.textContent = `${pillarId}: points sum to ${sum}, must be 20`;
    validationDiv.appendChild(el);
  }
}

// Impact analyzer: add new metric row
function addNewMetricRow() {
  const template = document.getElementById('newMetricTemplate');
  if (!template) return;
  const clone = template.content.cloneNode(true);
  document.getElementById('newMetricsList').appendChild(clone);
}

// Consistency rules: expand/collapse a rule card
function toggleRuleCard(button) {
  const body = button.closest('.rule-card').querySelector('.rule-card-body');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  button.textContent = open ? '[+]' : '[-]';
}

// Consistency rules: mark a rule for deletion (kept in DOM with .rule-deleted class so we still know its id)
function markRuleDeleted(button) {
  const card = button.closest('.rule-card');
  if (!card) return;
  if (card.classList.contains('rule-deleted')) {
    card.classList.remove('rule-deleted');
    button.innerHTML = '&times;';
    button.title = 'Delete rule';
  } else {
    card.classList.add('rule-deleted');
    button.innerHTML = '↶';
    button.title = 'Undo delete';
  }
}

// Consistency rules: add a new (empty) rule
function addRuleRow() {
  const template = document.getElementById('ruleTemplate');
  if (!template) return;
  const clone = template.content.cloneNode(true);
  const list = document.getElementById('rulesList');
  list.appendChild(clone);
  const newCard = list.lastElementChild;
  if (newCard) {
    const tpl = newCard.dataset.template || 't1';
    attachTemplateRecompute(newCard);
    applyTemplate(newCard, tpl);
  }
}

// =============================================================================
// Rules page: guided authoring templates
// =============================================================================

const RULE_TEMPLATES = ['t1', 't2', 't3', 't4', 't5', 'custom'];

// Switch a rule card to the chosen authoring template: show its form group,
// hide the others, and toggle the JSON textarea readonly. Custom mode keeps
// today's free-edit JSON behaviour.
function applyTemplate(card, templateId) {
  if (!card || !RULE_TEMPLATES.includes(templateId)) return;
  card.dataset.template = templateId;

  card.querySelectorAll('.template-form').forEach(div => {
    div.style.display = (div.dataset.tpl === templateId) ? '' : 'none';
  });

  const sel = card.querySelector('.rule-template-select');
  if (sel && sel.value !== templateId) sel.value = templateId;

  const ta = card.querySelector('.rule-applies-when');
  if (ta) {
    if (templateId === 'custom') {
      ta.removeAttribute('readonly');
      ta.classList.remove('rule-applies-when-readonly');
    } else {
      ta.setAttribute('readonly', 'readonly');
      ta.classList.add('rule-applies-when-readonly');
      recomputeAppliesWhen(card);
    }
  }
}

// Recompute the applies_when JSON from the structured form fields and write
// it into the .rule-applies-when textarea. No-op for the custom template.
function recomputeAppliesWhen(card) {
  if (!card) return;
  const tpl = card.dataset.template;
  if (!tpl || tpl === 'custom') return;

  function val(sel) { const el = card.querySelector(sel); return el ? el.value.trim() : ''; }
  function values(sel) {
    const raw = val(sel);
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  let predicate = null;
  if (tpl === 't1') {
    predicate = { all_of: [
      { metric: val('.tpl-t1-metric-a'), in: values('.tpl-t1-values-a') },
      { metric: val('.tpl-t1-metric-b'), in: values('.tpl-t1-values-b') },
    ] };
  } else if (tpl === 't2') {
    predicate = { all_of: [
      { metric: val('.tpl-t2-metric-a'), is_truthy: true },
      { metric: val('.tpl-t2-metric-b'), in: values('.tpl-t2-values-b') },
    ] };
  } else if (tpl === 't3') {
    const op = val('.tpl-t3-op') || 'lt';
    const numRaw = val('.tpl-t3-number');
    const numLeaf = { metric: val('.tpl-t3-metric-b') };
    numLeaf[op] = numRaw === '' ? 0 : parseFloat(numRaw);
    predicate = { all_of: [
      { metric: val('.tpl-t3-metric-a'), in: values('.tpl-t3-values-a') },
      numLeaf,
    ] };
  } else if (tpl === 't4') {
    // Workload-gated condition: { workload_profile, metric leaf }
    const profiles = values('.tpl-t4-profiles');
    const profileLeaf = profiles.length === 1
      ? { workload_profile: profiles[0] }
      : { workload_profile: { in: profiles } };
    const metricLeaf = buildMetricLeaf(val('.tpl-t4-metric'), val('.tpl-t4-op'), val('.tpl-t4-value'));
    predicate = { all_of: [profileLeaf, metricLeaf] };
  } else if (tpl === 't5') {
    // System-fact gated: { system_fact, metric leaf }
    const anchor = val('.tpl-t5-anchor') || 'ram_kb';
    const anchorOp = val('.tpl-t5-anchor-op') || 'gte';
    const anchorRaw = val('.tpl-t5-anchor-value');
    const factLeaf = { system_fact: anchor };
    factLeaf[anchorOp] = anchorRaw === '' ? 0 : parseFloat(anchorRaw);
    const metricLeaf = buildMetricLeaf(val('.tpl-t5-metric'), val('.tpl-t5-op'), val('.tpl-t5-value'));
    predicate = { all_of: [factLeaf, metricLeaf] };
  }

  const ta = card.querySelector('.rule-applies-when');
  if (ta && predicate) ta.value = JSON.stringify(predicate, null, 2);
}

// Build a metric leaf from a UI-friendly operator. The select offers
// is_truthy_true / is_truthy_false sugar that maps to { is_truthy: bool },
// otherwise the operator is passed through verbatim (equals/in/lt/…).
function buildMetricLeaf(metricName, op, rawValue) {
  const leaf = { metric: metricName };
  if (op === 'is_truthy_true')  { leaf.is_truthy = true;  return leaf; }
  if (op === 'is_truthy_false') { leaf.is_truthy = false; return leaf; }
  if (op === 'in') {
    leaf.in = (rawValue || '').split(',').map(s => s.trim()).filter(Boolean);
    return leaf;
  }
  if (['lt', 'lte', 'gt', 'gte'].includes(op)) {
    leaf[op] = rawValue === '' ? 0 : parseFloat(rawValue);
    return leaf;
  }
  // default: equals
  leaf.equals = rawValue;
  return leaf;
}

// Attach live-recompute listeners to every structured field inside a card.
function attachTemplateRecompute(card) {
  if (!card) return;
  card.querySelectorAll('.template-form input, .template-form select').forEach(el => {
    el.addEventListener('input', () => recomputeAppliesWhen(card));
    el.addEventListener('change', () => recomputeAppliesWhen(card));
  });
}

// Initialize all rule cards present on first paint.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.rule-card').forEach(card => {
    const tpl = card.dataset.template || 'custom';
    applyTemplate(card, tpl);
    attachTemplateRecompute(card);
  });
});

// Consistency rules: show/hide cap_pct vs points based on adjust type
function updateAdjustFields(select) {
  const card = select.closest('.rule-card');
  if (!card) return;
  const type = select.value;
  const cap = card.querySelector('.rule-adjust-cap');
  const pts = card.querySelector('.rule-adjust-points');
  const target = card.querySelector('.rule-adjust-target');
  if (cap) cap.style.opacity = type === 'subcategory_cap' ? '1' : '0.4';
  if (pts) pts.style.opacity = (type === 'subcategory_deduction' || type === 'pillar_deduction') ? '1' : '0.4';
  if (target) {
    target.style.opacity = type === 'none' ? '0.4' : '1';
    target.placeholder = type === 'metric_zero' ? 'metric legacy_name'
      : type === 'pillar_deduction' ? 'pillar_id'
      : type === 'none' ? '' : 'subcategory_id';
  }
}

// Consistency rules: gather a single rule object from a card
function collectRuleFromCard(card) {
  function val(sel) { const el = card.querySelector(sel); return el ? el.value.trim() : ''; }
  function num(sel) { const v = val(sel); return v === '' ? undefined : parseFloat(v); }

  const ruleId = val('.rule-id');
  if (!ruleId) return null;

  let appliesWhen;
  try {
    appliesWhen = JSON.parse(val('.rule-applies-when'));
  } catch (e) {
    appliesWhen = { __parse_error__: e.message };
  }

  const adjustType = val('.rule-adjust-type') || 'none';
  const score_adjustment = { type: adjustType };
  if (adjustType !== 'none') {
    const tgt = val('.rule-adjust-target');
    if (tgt) score_adjustment.target = tgt;
  }
  if (adjustType === 'subcategory_cap') {
    const c = num('.rule-adjust-cap');
    if (c !== undefined) score_adjustment.cap_pct = c;
  }
  if (adjustType === 'subcategory_deduction' || adjustType === 'pillar_deduction') {
    const p = num('.rule-adjust-points');
    if (p !== undefined) score_adjustment.points = p;
  }

  const tagsRaw = val('.rule-tags');
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const pillarHint = val('.rule-pillar-hint');

  const rule = {
    rule_id: ruleId,
    title: val('.rule-title'),
    description: val('.rule-description'),
    applies_when: appliesWhen,
    on_violation: {
      severity: val('.rule-severity-input') || 'warning',
      score_adjustment,
      title: val('.rule-violation-title'),
      description: val('.rule-violation-description'),
      remediation: val('.rule-remediation'),
    },
  };
  // v1.8.0 — multi-adjustment rules (score_adjustments[]) are authored via
  // raw catalog JSON, not this form. Preserve the original array verbatim so
  // editing the rule's texts here doesn't downgrade it to the singular shape.
  if (card.dataset.scoreAdjustments) {
    try {
      rule.on_violation.score_adjustments = JSON.parse(card.dataset.scoreAdjustments);
      delete rule.on_violation.score_adjustment;
    } catch (e) { /* malformed attribute — keep the singular form */ }
  }
  if (tags.length) rule.tags = tags;
  if (pillarHint) rule.pillar_hint = pillarHint;
  return rule;
}

// Impact analyzer: collect all changes from the UI
function collectChanges() {
  // Subcategory point changes
  const subcategoryPoints = {};
  document.querySelectorAll('.subcat-points').forEach(input => {
    const original = parseFloat(input.defaultValue);
    const current = parseFloat(input.value);
    if (current !== original) {
      subcategoryPoints[input.dataset.subcat] = current;
    }
  });

  // Metric criticality changes
  const metricCriticality = {};
  document.querySelectorAll('.metric-crit').forEach(select => {
    const options = select.querySelectorAll('option');
    const original = Array.from(options).find(o => o.defaultSelected);
    if (original && select.value !== original.value) {
      metricCriticality[select.dataset.metric] = select.value;
    }
  });

  // Flat threshold edits (Simulator 2.0): only metrics whose inputs moved.
  const evaluationConfigChanges = {};
  document.querySelectorAll('.metric-thresholds[data-editable="1"]').forEach(box => {
    const type = box.dataset.evaltype;
    const changed = {};
    const moved = (input) => input && input.value !== input.defaultValue;
    if (type === 'boolean') {
      const inp = box.querySelector('.thr-pass-value');
      if (moved(inp)) {
        const v = inp.value.trim();
        changed.pass_value = v === 'true' ? true : v === 'false' ? false : v;
      }
    } else if (type === 'enum') {
      const inp = box.querySelector('.thr-pass-values');
      if (moved(inp)) changed.pass_values = inp.value.split(',').map(x => x.trim()).filter(Boolean);
    } else {
      const minI = box.querySelector('.thr-min');
      const maxI = box.querySelector('.thr-max');
      if (moved(minI)) changed.min = minI.value.trim() === '' ? null : (Number.isFinite(parseFloat(minI.value)) ? parseFloat(minI.value) : undefined);
      if (moved(maxI)) changed.max = maxI.value.trim() === '' ? null : (Number.isFinite(parseFloat(maxI.value)) ? parseFloat(maxI.value) : undefined);
      if (changed.min === undefined) delete changed.min;
      if (changed.max === undefined) delete changed.max;
    }
    if (Object.keys(changed).length) evaluationConfigChanges[box.dataset.metric] = changed;
  });

  // Disabled (removed) metrics
  const disabledMetrics = [];
  document.querySelectorAll('.metric-toggle').forEach(cb => {
    if (!cb.checked) {
      disabledMetrics.push(cb.dataset.metric);
    }
  });

  // New metrics
  const newMetrics = [];
  document.querySelectorAll('.new-metric-form').forEach(form => {
    const id = form.querySelector('.nm-id').value.trim();
    const legacy = form.querySelector('.nm-legacy').value.trim();
    const display = form.querySelector('.nm-display').value.trim();
    const subcat = form.querySelector('.nm-subcategory').value;
    const crit = form.querySelector('.nm-criticality').value;
    const evalType = form.querySelector('.nm-evaltype').value;
    const sampleValue = form.querySelector('.nm-value').value.trim();
    const source = form.querySelector('.nm-source').value;
    const licenseEl = form.querySelector('.nm-license');
    const license = licenseEl ? licenseEl.value : '';

    if (id && legacy) {
      newMetrics.push({
        metric_id: id,
        legacy_name: legacy,
        display_name: display || legacy,
        subcategory: subcat,
        criticality: crit,
        evaluation_type: evalType,
        sources: [source],
        license_requirement: license || null,
        sampleValue: sampleValue,
      });
    }
  });

  // Consistency rules: figure out upserts vs deletions
  const rulesList = document.getElementById('rulesList');
  const originalRuleIds = rulesList
    ? (rulesList.dataset.originalRuleIds || '').split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const upsertedRules = [];
  const presentIds = new Set();
  document.querySelectorAll('.rule-card').forEach(card => {
    if (card.classList.contains('rule-deleted')) return;
    const r = collectRuleFromCard(card);
    if (!r) return;
    presentIds.add(r.rule_id);
    upsertedRules.push(r);
  });
  const deletedRules = originalRuleIds.filter(id => !presentIds.has(id));

  return {
    evaluationConfigChanges, subcategoryPoints, metricCriticality, disabledMetrics, newMetrics, upsertedRules, deletedRules };
}

// =============================================================================
// Rules page: validate / export-full / export-rules
// =============================================================================

function rulesTechFromUrl() {
  // Path is /metrics/<tech>/rules
  const parts = window.location.pathname.split('/');
  return parts[2] || 'postgresql';
}

function renderRulesValidation(validation, counts) {
  const el = document.getElementById('rulesValidation');
  if (!el) return;
  if (!validation) { el.innerHTML = ''; return; }
  if (validation.valid) {
    el.innerHTML = `<div class="validation-ok">Catalog + rule structure valid · original ${counts.original} → modified ${counts.modified} (${counts.upserted} upserted, ${counts.deleted} deleted).</div>`;
  } else {
    el.innerHTML = '<div class="validation-error"><strong>Validation errors:</strong><ul>' +
      validation.errors.map(e => `<li>${e}</li>`).join('') +
      '</ul></div>';
  }
  const summary = document.getElementById('rulesSummary');
  if (summary) {
    summary.textContent = counts ? `Pending: ${counts.upserted} upserted, ${counts.deleted} deleted` : '';
  }
}

function rulesPayload() {
  const c = collectChanges();
  return { changes: { upsertedRules: c.upsertedRules, deletedRules: c.deletedRules } };
}

function validateRules() {
  const tech = rulesTechFromUrl();
  fetch(`/metrics/${tech}/rules/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rulesPayload()),
  })
    .then(r => r.json())
    .then(data => renderRulesValidation(data.validation, data.counts));
}

function downloadRulesExport(endpoint, fallbackName) {
  const tech = rulesTechFromUrl();
  fetch(`/metrics/${tech}/rules/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rulesPayload()),
  })
    .then(r => {
      if (!r.ok) {
        return r.json().then(data => {
          renderRulesValidation(data.validation, { original: 0, modified: 0, upserted: 0, deleted: 0 });
          alert('Export failed — see validation errors on the page.');
          throw new Error('export validation failed');
        });
      }
      const filename = r.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || fallbackName;
      return r.blob().then(blob => ({ blob, filename }));
    })
    .then(({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => {});
}

function exportRulesFullCatalog() {
  downloadRulesExport('export-full', `${rulesTechFromUrl()}-catalog-with-rules.json`);
}

function exportRulesOnly() {
  downloadRulesExport('export-rules', `${rulesTechFromUrl()}-consistency-rules.json`);
}

// Impact analyzer: compare original vs modified
function compareImpact() {
  const tech = window.location.pathname.split('/')[2];
  const scenario = document.getElementById('impactScenario').value;
  const changes = collectChanges();

  // Show summary of pending changes
  const parts = [];
  if (Object.keys(changes.subcategoryPoints).length) parts.push(`${Object.keys(changes.subcategoryPoints).length} point changes`);
  if (Object.keys(changes.metricCriticality).length) parts.push(`${Object.keys(changes.metricCriticality).length} criticality changes`);
  if (changes.disabledMetrics.length) parts.push(`${changes.disabledMetrics.length} removed`);
  if (changes.newMetrics.length) parts.push(`${changes.newMetrics.length} added`);
  if (changes.upsertedRules && changes.upsertedRules.length) parts.push(`${changes.upsertedRules.length} rules upserted`);
  if (changes.deletedRules && changes.deletedRules.length) parts.push(`${changes.deletedRules.length} rules deleted`);
  const summaryEl = document.getElementById('changesSummary');
  if (summaryEl) {
    summaryEl.textContent = parts.length > 0 ? `Changes: ${parts.join(', ')}` : '';
  }

  fetch(`/impact/${tech}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, scenario }),
  })
    .then(r => r.json())
    .then(data => {
      renderComparison(data);
      // Enable export button if validation passed
      const exportBtn = document.getElementById('exportBtn');
      if (exportBtn) {
        exportBtn.disabled = !data.validation || !data.validation.valid;
      }
    });
}

// Impact analyzer: export the modified catalog as a rules bundle download
function exportCatalog() {
  const tech = window.location.pathname.split('/')[2];
  const changes = collectChanges();

  fetch(`/impact/${tech}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  })
    .then(r => {
      if (!r.ok) {
        return r.json().then(data => {
          let msg = 'Export failed.';
          if (data.validation && data.validation.errors) {
            msg += '\n' + data.validation.errors.join('\n');
          }
          alert(msg);
          throw new Error(msg);
        });
      }
      const filename = r.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `${tech}-rules-bundle.json`;
      return r.blob().then(blob => ({ blob, filename }));
    })
    .then(({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => {});
}

function renderComparison(data) {
  const container = document.getElementById('impactResults');
  if (!container) return;

  const diff = data.diff;
  const diffClass = diff.totalScore > 0 ? 'diff-positive' : diff.totalScore < 0 ? 'diff-negative' : 'diff-zero';
  const diffSign = diff.totalScore > 0 ? '+' : '';

  let html = `
    <div class="comparison-card">
      <h3>Total Score</h3>
      <div class="comparison-row">
        <span class="comparison-label">Original</span>
        <span>${data.original.totalScore} (${data.original.totalPercentage}%) - ${data.original.status}${dispositionSuffix(data.original.disposition)}</span>
      </div>
      <div class="comparison-row">
        <span class="comparison-label">Modified</span>
        <span>${data.modified.totalScore} (${data.modified.totalPercentage}%) - ${data.modified.status}${dispositionSuffix(data.modified.disposition)}</span>
      </div>
      <div class="comparison-row">
        <span class="comparison-label">Difference</span>
        <span class="${diffClass}">${diffSign}${diff.totalScore.toFixed(2)} points (${diffSign}${diff.totalPercentage}%)</span>
      </div>
    </div>
  `;

  // Metric count change
  if (data.diff.metricCount !== undefined && data.diff.metricCount !== 0) {
    const mcSign = data.diff.metricCount > 0 ? '+' : '';
    const mcClass = data.diff.metricCount > 0 ? 'diff-positive' : 'diff-negative';
    html += `
    <div class="comparison-card">
      <h3>Catalog Changes</h3>
      <div class="comparison-row">
        <span class="comparison-label">Metrics</span>
        <span>${data.original.metricCount} -> ${data.modified.metricCount} <span class="${mcClass}">(${mcSign}${data.diff.metricCount})</span></span>
      </div>
    `;
    if (data.changes) {
      if (data.changes.removed > 0) html += `<div class="comparison-row"><span class="comparison-label">Removed</span><span class="diff-negative">${data.changes.removed} metrics</span></div>`;
      if (data.changes.added > 0) html += `<div class="comparison-row"><span class="comparison-label">Added</span><span class="diff-positive">${data.changes.added} metrics</span></div>`;
      if (data.changes.criticalityChanged > 0) html += `<div class="comparison-row"><span class="comparison-label">Criticality changed</span><span>${data.changes.criticalityChanged} metrics</span></div>`;
      if (data.changes.pointsChanged > 0) html += `<div class="comparison-row"><span class="comparison-label">Points rebalanced</span><span>${data.changes.pointsChanged} subcategories</span></div>`;
    }
    html += '</div>';
  }

  html += `
    <div class="comparison-card">
      <h3>Per Pillar</h3>
  `;

  for (const [id, op] of Object.entries(data.original.pillars)) {
    const mp = data.modified.pillars[id];
    const pDiff = mp.score - op.score;
    const pClass = pDiff > 0 ? 'diff-positive' : pDiff < 0 ? 'diff-negative' : 'diff-zero';
    const pSign = pDiff > 0 ? '+' : '';
    html += `
      <div class="comparison-row">
        <span class="comparison-label">${op.name}</span>
        <span>${op.score} -> ${mp.score} <span class="${pClass}">(${pSign}${pDiff.toFixed(2)})</span></span>
      </div>
    `;
  }

  html += '</div>';

  // Consistency findings before/after
  if (data.consistencyFindings) {
    const before = data.consistencyFindings.original || [];
    const after  = data.consistencyFindings.modified || [];
    const beforeIds = new Set(before.map(f => f.rule_id));
    const afterIds = new Set(after.map(f => f.rule_id));
    const newlyFiring = after.filter(f => !beforeIds.has(f.rule_id));
    const stoppedFiring = before.filter(f => !afterIds.has(f.rule_id));
    if (before.length || after.length) {
      html += `<div class="comparison-card"><h3>Consistency rules</h3>`;
      html += `<div class="comparison-row"><span class="comparison-label">Firing on original</span><span>${before.length}</span></div>`;
      html += `<div class="comparison-row"><span class="comparison-label">Firing on modified</span><span>${after.length}</span></div>`;
      if (newlyFiring.length) {
        html += `<div class="comparison-row diff-positive"><span class="comparison-label">+ Newly firing</span><span>${newlyFiring.map(f => f.rule_id).join(', ')}</span></div>`;
      }
      if (stoppedFiring.length) {
        html += `<div class="comparison-row diff-negative"><span class="comparison-label">- Stopped firing</span><span>${stoppedFiring.map(f => f.rule_id).join(', ')}</span></div>`;
      }
      html += `</div>`;
    }
  }

  if (data.validation && !data.validation.valid) {
    html += '<div class="validation-error"><strong>Validation errors:</strong><ul>';
    for (const err of data.validation.errors) {
      html += `<li>${err}</li>`;
    }
    html += '</ul></div>';
  } else {
    html += '<div class="validation-ok">Catalog structure is valid.</div>';
  }

  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Simulator 2.0 — theme toggle (persisted; the header applies it before paint)
// ---------------------------------------------------------------------------
function toggleTheme() {
  const html = document.documentElement;
  const explicit = html.getAttribute('data-theme');
  const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = explicit || (osDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem('sim-theme', next); } catch (e) { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Simulator 2.0 — "Import a collected payload"
// ---------------------------------------------------------------------------
function readPayloadText() {
  const raw = document.getElementById('payloadText').value.trim();
  if (!raw) throw new Error('Paste a JSON payload first.');
  const parsed = JSON.parse(raw);
  const body = parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object' ? parsed : { values: parsed };
  return body;
}

function checkPayloadShape() {
  const status = document.getElementById('payloadStatus');
  const report = document.getElementById('payloadReport');
  let body;
  try { body = readPayloadText(); } catch (e) { report.innerHTML = `<p class="payload-error">${escapeHtml(e.message)}</p>`; return; }
  status.textContent = 'Checking...';
  const tech = window.location.pathname.split('/')[2];
  fetch(`/simulate/${tech}/check-payload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(data => {
      status.textContent = '';
      if (data.error) { report.innerHTML = `<p class="payload-error">${escapeHtml(data.error)}</p>`; return; }
      const c = data.counts;
      const chip = (label, n, cls) => `<span class="chip ${n ? cls : 'chip-muted'}">${n} ${label}</span>`;
      const chips = [
        chip('ok', c.ok, 'chip-ok'), chip('unparseable', c.unparseable, 'chip-bad'), chip('unit suspect', c.unitSuspect, 'chip-warn'),
        chip('enum mismatch', c.enumMismatch, 'chip-warn'), chip('not provided', c.notProvided, 'chip-muted'),
        chip('critical not provided', c.criticalNotProvided, 'chip-bad'), chip('not applicable', c.notApplicable, 'chip-muted'),
        chip('unknown keys', c.unknownKeys, 'chip-warn'),
      ].join('');
      const rows = data.metrics
        .filter(m => !['ok', 'derived', 'not_applicable'].includes(m.status))
        .sort((a, b) => a.status.localeCompare(b.status) || a.metric_id.localeCompare(b.metric_id))
        .map(m => `<tr><td><span class="badge badge-sm ${m.status === 'unparseable' || (m.status === 'not_provided' && m.criticality === 'critical') ? 'badge-critical' : m.status === 'not_provided' ? 'badge-advisory' : 'badge-important'}">${escapeHtml(m.status.replace('_', ' '))}</span></td><td><code>${escapeHtml(m.metric_id)}</code></td><td>${escapeHtml(m.display_name)}<br><small class="text-muted">${escapeHtml(m.legacy_name)}</small></td><td>${escapeHtml(m.detail || '')}</td></tr>`)
        .join('');
      const unknown = data.unknownKeys.length ? `<p class="text-muted">Unknown keys: ${data.unknownKeys.map(escapeHtml).join(', ')}</p>` : '';
      report.innerHTML = `<div class="payload-chips">${chips}</div>${unknown}` +
        (rows ? `<div class="payload-table-wrap"><table class="data-table compact"><thead><tr><th>Status</th><th>Metric</th><th>Name</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="text-muted">Every provided value has the shape the catalog expects.</p>');
    })
    .catch(e => { status.textContent = ''; report.innerHTML = `<p class="payload-error">${escapeHtml(e.message)}</p>`; });
}

function scorePayload() {
  const report = document.getElementById('payloadReport');
  let body;
  try { body = readPayloadText(); } catch (e) { report.innerHTML = `<p class="payload-error">${escapeHtml(e.message)}</p>`; return; }
  const form = document.getElementById('simulatorForm');
  let loaded = 0;
  const missing = [];
  const unmatched = [];
  for (const [name, value] of Object.entries(body.values || {})) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) { missing.push(name); continue; }
    const v = value === null || value === undefined ? '' : String(value);
    if (input.tagName === 'SELECT') {
      const opt = Array.from(input.options).find(o => o.value === v || o.value.toLowerCase() === v.toLowerCase());
      if (!opt) { unmatched.push(`${name}=${v}`); input.value = input.querySelector('option[value="INVALID"]') ? 'INVALID' : ''; continue; }
      input.value = opt.value;
    } else {
      input.value = v;
    }
    loaded++;
  }
  const facts = body.systemFacts || {};
  if (facts.ram_kb && document.getElementById('sysRamGb')) document.getElementById('sysRamGb').value = (facts.ram_kb / 1048576).toFixed(2).replace(/\.00$/, '');
  if (facts.cpu_count && document.getElementById('sysCpu')) document.getElementById('sysCpu').value = facts.cpu_count;
  if (facts.storage_size_kb && document.getElementById('sysStorageGb')) document.getElementById('sysStorageGb').value = Math.round(facts.storage_size_kb / 1048576);
  if (facts.edition && document.getElementById('sysEdition')) document.getElementById('sysEdition').value = String(facts.edition).toLowerCase();
  if (body.workloadProfile && document.getElementById('workloadProfile')) document.getElementById('workloadProfile').value = body.workloadProfile;
  if (Array.isArray(body.licensedOptions)) {
    document.querySelectorAll('.license-opt').forEach(cb => { cb.checked = body.licensedOptions.map(x => String(x).toLowerCase()).includes(cb.value.toLowerCase()); });
  }
  document.getElementById('payloadStatus').textContent = `${loaded} values loaded into the form` + (missing.length ? `, ${missing.length} keys have no input (not in the active catalog)` : '') + (unmatched.length ? `, ${unmatched.length} values outside the option list set to fail (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ', ...' : ''})` : '') + '. Scoring...';
  recalculate();
}
