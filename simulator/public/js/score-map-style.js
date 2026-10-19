/* Score Map — shared cytoscape style, layout, and highlight logic.
 *
 * Pure presentation + cytoscape-only operations (no DOM, no app-specific UI),
 * so this single file drives BOTH the interactive page (loaded via <script src>)
 * and the self-contained HTML export (inlined verbatim by the export route).
 * Keep it framework-light and side-effect-free beyond defining globals.
 *
 * Visual encoding:
 *   metric node : fill = pillar colour, border = criticality (red/amber/grey),
 *                 diamond if engine-derived
 *   rule node   : hexagon, fill = severity
 *   subcategory : rounded box, pillar colour       pillar : larger box, pillar colour
 *   edges       : derives (blue) · triggers (dashed purple) · affects (by effect)
 *                 · gates (dotted grey) · crit_gate (dashed orange) · rolls_up (faint)
 */

window.SCORE_MAP_LAYOUT = {
  name: 'dagre',
  rankDir: 'LR',
  nodeSep: 16,
  rankSep: 90,
  edgeSep: 8,
  ranker: 'network-simplex',
  fit: true,
  padding: 30,
};

window.SCORE_MAP_STYLE = [
  // --- Nodes ---------------------------------------------------------------
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 9,
      'text-wrap': 'wrap',
      'text-max-width': 110,
      'text-valign': 'center',
      'text-halign': 'center',
      color: '#fff',
      'overlay-opacity': 0,
    },
  },
  {
    selector: '.metric',
    style: {
      shape: 'round-rectangle',
      'background-color': 'data(color)',
      width: 'label',
      height: 'label',
      padding: 7,
      'border-width': 1,
      'border-color': '#cbd5e1',
      'font-size': 8,
      'text-max-width': 96,
    },
  },
  { selector: '.crit-critical', style: { 'border-width': 3, 'border-color': '#b91c1c' } },
  { selector: '.crit-important', style: { 'border-width': 2, 'border-color': '#b45309' } },
  { selector: '.crit-advisory', style: { 'border-width': 1, 'border-color': '#e2e8f0' } },
  { selector: '.derived', style: { shape: 'diamond', padding: 10 } },
  { selector: '.licensed', style: { 'background-color': '#fef9c3', 'background-opacity': 1 } },
  { selector: '.metric-ghost', style: { 'background-opacity': 0.45, 'border-style': 'dashed', color: '#475569' } },
  {
    selector: '.systemfact, .workload',
    style: {
      shape: 'round-rectangle', 'background-color': '#e2e8f0', color: '#334155',
      width: 'label', height: 'label', padding: 5, 'font-size': 8, 'border-width': 1, 'border-color': '#94a3b8',
    },
  },
  {
    selector: '.rule',
    style: {
      shape: 'hexagon', 'background-color': '#6b7280', width: 'label', height: 'label',
      padding: 8, 'font-size': 9, 'font-weight': 'bold', 'border-width': 1, 'border-color': '#374151',
    },
  },
  { selector: '.rule.sev-critical', style: { 'background-color': '#b91c1c' } },
  { selector: '.rule.sev-warning', style: { 'background-color': '#d97706' } },
  { selector: '.rule.sev-info', style: { 'background-color': '#2563eb' } },
  {
    selector: '.subcategory',
    style: {
      shape: 'round-rectangle', 'background-color': 'data(color)', 'background-opacity': 0.82,
      width: 'label', height: 'label', padding: 9, 'font-size': 10, 'border-width': 1, 'border-color': '#334155',
    },
  },
  {
    selector: '.pillar',
    style: {
      shape: 'round-rectangle', 'background-color': 'data(color)', width: 'label', height: 'label',
      padding: 12, 'font-size': 12, 'font-weight': 'bold', 'border-width': 2, 'border-color': '#1a1a2e',
    },
  },

  // --- Edges ---------------------------------------------------------------
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      width: 1.5,
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      label: 'data(label)',
      'font-size': 7,
      'text-rotation': 'autorotate',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': 1,
      color: '#334155',
    },
  },
  { selector: '.rolls-up', style: { 'line-color': '#cbd5e1', 'target-arrow-color': '#cbd5e1', width: 1, opacity: 0.45 } },
  { selector: '.derives', style: { 'line-color': '#2563eb', 'target-arrow-color': '#2563eb' } },
  { selector: '.triggers', style: { 'line-color': '#7c3aed', 'target-arrow-color': '#7c3aed', 'line-style': 'dashed' } },
  { selector: '.affects', style: { width: 2 } },
  { selector: '.affect-zero', style: { 'line-color': '#b91c1c', 'target-arrow-color': '#b91c1c' } },
  { selector: '.affect-deduct', style: { 'line-color': '#d97706', 'target-arrow-color': '#d97706' } },
  { selector: '.affect-cap', style: { 'line-color': '#b45309', 'target-arrow-color': '#b45309', 'line-style': 'dashed' } },
  { selector: '.affect-pillar', style: { 'line-color': '#be123c', 'target-arrow-color': '#be123c' } },
  { selector: '.gates', style: { 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'line-style': 'dotted' } },
  { selector: '.crit-gate', style: { 'line-color': '#ea580c', 'target-arrow-color': '#ea580c', 'line-style': 'dashed', width: 1.5 } },

  // --- Live highlight (current scenario) -----------------------------------
  { selector: 'node.hl-fired', style: { 'border-width': 4, 'border-color': '#f59e0b' } },
  { selector: 'edge.hl-fired', style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', width: 3.5, opacity: 1, 'z-index': 99 } },
  { selector: 'node.hl-failed', style: { 'border-width': 4, 'border-color': '#dc2626' } },
  { selector: 'node.hl-pass', style: { 'border-width': 3, 'border-color': '#16a34a' } },
  { selector: '.hl-inactive', style: { opacity: 0.22 } },

  // --- Interaction states --------------------------------------------------
  { selector: '.faded', style: { opacity: 0.1, 'text-opacity': 0.1 } },
  { selector: '.hidden', style: { display: 'none' } },
];

// Dark variant for the progressive drill's leaf graph (OpsHub-style page).
// Reuses the light encoding, then overrides label/edge colours for a dark
// canvas and adds the cross-subcategory "portal" node style. The Expert flat
// graph and the self-contained export keep SCORE_MAP_STYLE (light).
window.SCORE_MAP_STYLE_DARK = window.SCORE_MAP_STYLE.concat([
  { selector: 'edge', style: { 'text-background-color': '#0f172a', 'text-background-opacity': 0.9, color: '#cbd5e1' } },
  { selector: '.rolls-up', style: { 'line-color': '#475569', 'target-arrow-color': '#475569', opacity: 0.5 } },
  { selector: '.crit-advisory', style: { 'border-color': '#475569' } },
  { selector: '.licensed', style: { 'background-color': '#422006' } },
  { selector: '.systemfact, .workload', style: { 'background-color': '#334155', color: '#e2e8f0', 'border-color': '#64748b' } },
  // Cross-subcategory portal: a dashed, muted pill that navigates on tap.
  {
    selector: '.portal',
    style: {
      shape: 'round-rectangle', 'background-color': '#334155', 'background-opacity': 0.55,
      'border-width': 1, 'border-color': '#64748b', 'border-style': 'dashed',
      color: '#cbd5e1', 'font-size': 8, width: 'label', height: 'label', padding: 6,
    },
  },
]);

/** Build a highlight bundle from a /calculate response. Shared by live + export. */
window.scoreMapHighlightFromResult = function (data) {
  if (!data) return null;
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const failed = metrics
    .filter((m) => m.applicable && ((m.scored && !m.passed) || (!m.scored)))
    .map((m) => m.name);
  const passed = metrics
    .filter((m) => m.applicable && m.scored && m.passed)
    .map((m) => m.name);
  const inactive = (Array.isArray(data.notApplicable) ? data.notApplicable : []).map((m) => m.name);
  const pillars = {};
  Object.keys(data.pillars || {}).forEach((pid) => {
    const p = data.pillars[pid];
    pillars[pid] = { name: p.name, score: p.score, maxScore: p.maxScore };
  });
  return { firedRules: data.firedRules || [], failed, passed, inactive, pillars };
};

window.scoreMapClearHighlight = function (cy) {
  cy.elements().removeClass('hl-fired hl-failed hl-pass hl-inactive');
  cy.nodes('.pillar').forEach((pn) => pn.data('label', pn.data('baseLabel')));
};

window.scoreMapApplyHighlight = function (cy, hl) {
  window.scoreMapClearHighlight(cy);
  if (!hl) return;
  (hl.firedRules || []).forEach((rid) => {
    const rn = cy.getElementById('r:' + rid);
    if (rn.nonempty()) {
      rn.addClass('hl-fired');
      rn.connectedEdges('.triggers, .affects').addClass('hl-fired');
    }
  });
  (hl.failed || []).forEach((n) => cy.getElementById('m:' + n).addClass('hl-failed'));
  (hl.passed || []).forEach((n) => cy.getElementById('m:' + n).addClass('hl-pass'));
  (hl.inactive || []).forEach((n) => {
    const mn = cy.getElementById('m:' + n);
    mn.addClass('hl-inactive');
    mn.connectedEdges('.gates').addClass('hl-inactive');
  });
  if (hl.pillars) {
    Object.keys(hl.pillars).forEach((pid) => {
      const pn = cy.getElementById('p:' + pid);
      if (pn.nonempty()) {
        const p = hl.pillars[pid];
        pn.data('label', p.name + '\n' + p.score + '/' + p.maxScore);
      }
    });
  }
};
