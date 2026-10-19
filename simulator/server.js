'use strict';

const express = require('express');
const path = require('path');

const overviewRoutes = require('./routes/overview');
const metricsRoutes = require('./routes/metrics');
const simulateRoutes = require('./routes/simulate');
const impactRoutes = require('./routes/impact');
const scoreMapRoutes = require('./routes/score-map');
const modelRoutes = require('./routes/model');
const { getCatalog, SUPPORTED_TECHNOLOGIES } = require('../src');
const enginePackage = require('../package.json');

const app = express();
const PORT = process.env.PORT || 3000;
// Loopback by default: the simulator has no authentication and must not be
// reachable from the network (SECURITY.md). The Docker image sets
// SIMULATOR_HOST=0.0.0.0 and the compose file publishes the port on 127.0.0.1
// only. Not the generic HOST variable: conda and some shells set HOST to a
// build triple or the machine name.
const HOST = process.env.SIMULATOR_HOST || '127.0.0.1';

app.set('view engine', 'ejs');

// Shell locals (sidebar version chip): engine version from the root package,
// catalog version per technology. Available to every template.
app.locals.engineVersion = enginePackage.version;
app.locals.catalogVersionOf = (tech) => (SUPPORTED_TECHNOLOGIES.includes(tech) ? getCatalog(tech).version : '');
app.locals.catalogMaturityOf = (tech) => (SUPPORTED_TECHNOLOGIES.includes(tech) ? getCatalog(tech).maturity || '' : '');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Vendored browser bundles for the Score Map (cytoscape + dagre layout),
// served straight from node_modules so there is no build step. Resolved via
// each package's main entry (cytoscape blocks the package.json subpath through
// its "exports" map, so we derive the dist dir from the resolved main).
try {
  app.use('/vendor/dagre', express.static(path.join(path.dirname(require.resolve('dagre')), 'dist')));
  app.use('/vendor/cytoscape', express.static(path.dirname(require.resolve('cytoscape')))); // .../cytoscape/dist
  app.use('/vendor/cytoscape-dagre', express.static(path.dirname(require.resolve('cytoscape-dagre'))));
} catch (e) {
  console.warn('Score Map libraries not found — run `npm install` in simulator/ to enable the dependency graph.');
}

// Routes
app.get('/', (req, res) => {
  res.redirect('/overview/postgresql');
});

app.use('/overview', overviewRoutes);
app.use('/model', modelRoutes);
app.use('/metrics', metricsRoutes);
app.use('/simulate', simulateRoutes);
app.use('/impact', impactRoutes);
app.use('/score-map', scoreMapRoutes);

app.listen(PORT, HOST, () => {
  console.log(`Scoring Simulator running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
