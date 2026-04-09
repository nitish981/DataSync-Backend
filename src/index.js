// ----------------------------------------------------
// 📦 IMPORTS
// ----------------------------------------------------
const express = require('express');
const session = require('express-session');
const passport = require('./auth');
const crypto = require('crypto');
const { BigQuery } = require('@google-cloud/bigquery');

const pool = require('./db');
const { requireAuth } = require('./middleware');
const { ensureDataset, bindIngestSA } = require('./bigquery');

// ✅ Shopify imports
const { buildAuthURL, exchangeCodeForToken } = require('./shopify/oauth');
const { storeShopifyToken, getShopifyToken } = require('./shopify/secrets');
const {
  SHOPIFY_METRICS, SHOPIFY_DIMENSIONS,
  DEFAULT_METRICS, DEFAULT_DIMENSIONS,
  validateFields
} = require('./shopify/fields');
const { runShopifyIngestion } = require('./shopify/ingestion');

// ----------------------------------------------------
// 🚀 APP INIT
// ----------------------------------------------------
const app = express();
app.set('trust proxy', 1);

const port = process.env.PORT || 8080;

// ----------------------------------------------------
// 🔐 SESSION + PASSPORT
// ----------------------------------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: true,
      sameSite: 'none'
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ----------------------------------------------------
// 🧩 MIDDLEWARE
// ----------------------------------------------------
app.use(express.json());

// ----------------------------------------------------
// 🔐 GOOGLE AUTH ROUTES
// ----------------------------------------------------
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => { res.json({ success: true, user: req.user }); }
);

app.get('/auth/failure', (req, res) => {
  res.status(401).json({ error: 'authentication failed' });
});

// ----------------------------------------------------
// ❤️ HEALTH CHECK
// ----------------------------------------------------
app.get('/', (req, res) => { res.send('DataSync backend running'); });

// ----------------------------------------------------
// 🧪 BIGQUERY + DB TEST
// ----------------------------------------------------
app.get('/test-bq', async (req, res) => {
  try {
    const bq = new BigQuery();
    const [datasets] = await bq.getDatasets();
    res.json({ success: true, datasetCount: datasets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 🏗️ WORKSPACE HELPERS
// ----------------------------------------------------
function generateWorkspaceShortId() {
  return 'ws_' + crypto.randomBytes(3).toString('hex');
}

// ----------------------------------------------------
// 🏢 CREATE WORKSPACE
// ----------------------------------------------------
app.post('/workspaces', requireAuth, async (req, res) => {
  const name = req.body?.name || 'Untitled Workspace';
  try {
    while (true) {
      const shortId = generateWorkspaceShortId();
      const result = await pool.query(
        `INSERT INTO workspaces (short_id, name, owner_user_id)
         VALUES ($1, $2, $3) ON CONFLICT (short_id) DO NOTHING
         RETURNING id, short_id, name`,
        [shortId, name, req.user.id]
      );
      if (result.rows.length > 0) return res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    res.status(500).json({ error: 'workspace creation failed' });
  }
});

// ----------------------------------------------------
// 🔗 CONNECTOR ATTACH
// ----------------------------------------------------
const ALLOWED_CONNECTORS = ['shopify', 'meta', 'google'];

app.post('/workspaces/:shortId/connectors/:connector', requireAuth, async (req, res) => {
  const { shortId, connector } = req.params;

  if (!ALLOWED_CONNECTORS.includes(connector)) {
    return res.status(400).json({ error: 'invalid connector' });
  }

  const wsResult = await pool.query(
    `SELECT id FROM workspaces WHERE short_id = $1 AND owner_user_id = $2`,
    [shortId, req.user.id]
  );

  if (wsResult.rows.length === 0) return res.status(404).json({ error: 'workspace not found' });

  const workspaceId = wsResult.rows[0].id;
  const datasetId   = `${shortId}__${connector}`;

  await ensureDataset(datasetId);
  await bindIngestSA(datasetId);

  await pool.query(
    `INSERT INTO workspace_connectors (workspace_id, connector_type, dataset_id)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [workspaceId, connector, datasetId]
  );

  res.json({ workspace: shortId, connector, dataset: datasetId });
});

// ----------------------------------------------------
// 🛍️ SHOPIFY OAUTH START
// ----------------------------------------------------
app.get('/auth/shopify', requireAuth, async (req, res) => {
  const { shop, workspace } = req.query;

  if (!shop || !workspace) return res.status(400).json({ error: 'shop and workspace required' });

  const ws = await pool.query(
    `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
    [workspace, req.user.id]
  );
  if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized workspace' });

  const nonce = crypto.randomBytes(8).toString('hex');
  const state = `${nonce}:${workspace}`;
  res.redirect(buildAuthURL(shop, state));
});

// ----------------------------------------------------
// 🛍️ SHOPIFY OAUTH CALLBACK
// ----------------------------------------------------
app.get('/auth/shopify/callback', requireAuth, async (req, res) => {
  const { shop, code, state } = req.query;

  if (!shop || !code || !state) return res.status(400).json({ error: 'invalid callback params' });

  const [nonce, workspace] = state.split(':');
  if (!workspace) return res.status(400).json({ error: 'workspace ID missing from state' });

  const ws = await pool.query(
    `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
    [workspace, req.user.id]
  );
  if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized workspace' });

  const token     = await exchangeCodeForToken(shop, code);
  const secretRef = await storeShopifyToken(workspace, shop, token);

  await pool.query(
    `INSERT INTO shopify_stores (workspace_id, shop_domain, secret_ref, installed_by_user)
     VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, shop_domain) DO NOTHING`,
    [workspace, shop, secretRef, req.user.id]
  );

  res.json({ success: true, shop });
});

// ----------------------------------------------------
// 🧾 LIST SHOPIFY STORES
// ----------------------------------------------------
app.get('/workspaces/:id/shopify/stores', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT shop_domain, created_at, last_synced_at
     FROM shopify_stores WHERE workspace_id = $1`,
    [req.params.id]
  );
  res.json(result.rows);
});

// ----------------------------------------------------
// 📋 GET all available Shopify fields
// ----------------------------------------------------
app.get('/shopify/fields', requireAuth, (req, res) => {
  res.json({
    metrics:    SHOPIFY_METRICS,
    dimensions: SHOPIFY_DIMENSIONS,
    defaults: {
      metrics:    DEFAULT_METRICS,
      dimensions: DEFAULT_DIMENSIONS,
    },
  });
});

// ----------------------------------------------------
// 💾 GET saved field config for a workspace
// ----------------------------------------------------
app.get('/workspaces/:id/shopify/config', requireAuth, async (req, res) => {
  try {
    const ws = await pool.query(
      `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized' });

    const result = await pool.query(
      `SELECT selected_metrics, selected_dimensions, updated_at
       FROM connector_field_configs
       WHERE workspace_id = $1 AND connector_type = 'shopify'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.json({
        selected_metrics:    DEFAULT_METRICS,
        selected_dimensions: DEFAULT_DIMENSIONS,
        is_default: true,
      });
    }

    res.json({ ...result.rows[0], is_default: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 💾 SAVE field config for a workspace
// ----------------------------------------------------
app.post('/workspaces/:id/shopify/config', requireAuth, async (req, res) => {
  try {
    const ws = await pool.query(
      `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized' });

    const { metrics = DEFAULT_METRICS, dimensions = DEFAULT_DIMENSIONS } = req.body;
    validateFields(metrics, dimensions);

    await pool.query(
      `INSERT INTO connector_field_configs
         (workspace_id, connector_type, selected_metrics, selected_dimensions, updated_at)
       VALUES ($1, 'shopify', $2, $3, NOW())
       ON CONFLICT (workspace_id, connector_type)
       DO UPDATE SET
         selected_metrics    = EXCLUDED.selected_metrics,
         selected_dimensions = EXCLUDED.selected_dimensions,
         updated_at          = NOW()`,
      [req.params.id, metrics, dimensions]
    );

    res.json({ success: true, metrics, dimensions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// ▶️  MANUAL SYNC trigger
// ----------------------------------------------------
app.post('/workspaces/:id/shopify/sync', requireAuth, async (req, res) => {
  const workspaceId = req.params.id;

  try {
    const ws = await pool.query(
      `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
      [workspaceId, req.user.id]
    );
    if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized' });

    const storeResult = await pool.query(
      `SELECT ss.shop_domain, wc.dataset_id,
              COALESCE(cfc.selected_metrics,    $2::text[]) AS metrics,
              COALESCE(cfc.selected_dimensions, $3::text[]) AS dimensions
       FROM shopify_stores ss
       JOIN workspace_connectors wc
         ON wc.workspace_id = ss.workspace_id AND wc.connector_type = 'shopify'
       LEFT JOIN connector_field_configs cfc
         ON cfc.workspace_id = ss.workspace_id AND cfc.connector_type = 'shopify'
       WHERE ss.workspace_id = $1 LIMIT 1`,
      [workspaceId, DEFAULT_METRICS, DEFAULT_DIMENSIONS]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ error: 'No Shopify store connected to this workspace' });
    }

    const { shop_domain, dataset_id, metrics, dimensions } = storeResult.rows[0];

    const { rows: [log] } = await pool.query(
      `INSERT INTO sync_logs (workspace_id, connector_type, shop_domain, status)
       VALUES ($1, 'shopify', $2, 'running') RETURNING id`,
      [workspaceId, shop_domain]
    );

    // Fire-and-forget async ingestion
    (async () => {
      try {
        const accessToken = await getShopifyToken(workspaceId, shop_domain);
        const { rowsWritten } = await runShopifyIngestion({
          workspaceId, datasetId: dataset_id, shopDomain: shop_domain,
          accessToken, metrics, dimensions,
        });
        await pool.query(
          `UPDATE sync_logs SET status='success', rows_written=$1, finished_at=NOW() WHERE id=$2`,
          [rowsWritten, log.id]
        );
        await pool.query(
          `UPDATE shopify_stores SET last_synced_at=NOW() WHERE workspace_id=$1 AND shop_domain=$2`,
          [workspaceId, shop_domain]
        );
        console.log(`[ManualSync] ✅ workspace=${workspaceId} rows=${rowsWritten}`);
      } catch (err) {
        await pool.query(
          `UPDATE sync_logs SET status='failed', error_message=$1, finished_at=NOW() WHERE id=$2`,
          [err.message, log.id]
        );
        console.error(`[ManualSync] ❌ workspace=${workspaceId}:`, err.message);
      }
    })();

    res.json({ success: true, message: 'Sync started', log_id: log.id, shop: shop_domain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 📜 GET sync history
// ----------------------------------------------------
app.get('/workspaces/:id/shopify/sync/history', requireAuth, async (req, res) => {
  try {
    const ws = await pool.query(
      `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (ws.rows.length === 0) return res.status(403).json({ error: 'unauthorized' });

    const result = await pool.query(
      `SELECT id, shop_domain, status, rows_written, error_message, started_at, finished_at
       FROM sync_logs
       WHERE workspace_id = $1
       ORDER BY started_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 🚀 START SERVER
// ----------------------------------------------------
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
