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
const {
  buildAuthURL,
  exchangeCodeForToken
} = require('./shopify/oauth');

const {
  storeShopifyToken
} = require('./shopify/secrets');

// ----------------------------------------------------
// 🚀 APP INIT
// ----------------------------------------------------
const app = express();
app.set('trust proxy', 1);

const port = process.env.PORT || 8080;

// ----------------------------------------------------
// 🔐 SESSION + PASSPORT (MUST BE BEFORE ROUTES)
// ----------------------------------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,        // Added for Cloud Run proxy support
    cookie: {
      secure: true,     // REQUIRED for Cloud Run HTTPS
      sameSite: 'none'  // Changed to 'none' so session persists after Shopify redirect
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
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/failure'
  }),
  (req, res) => {
    res.json({ success: true, user: req.user });
  }
);

app.get('/auth/failure', (req, res) => {
  res.status(401).json({ error: 'authentication failed' });
});

// ----------------------------------------------------
// ❤️ HEALTH CHECK
// ----------------------------------------------------
app.get('/', (req, res) => {
  res.send('DataSync backend running');
});

// ----------------------------------------------------
// 🧪 BIGQUERY TEST
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

// ----------------------------------------------------
// 🧪 DATABASE TEST
// ----------------------------------------------------
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
         VALUES ($1, $2, $3)
         ON CONFLICT (short_id) DO NOTHING
         RETURNING id, short_id, name`,
        [shortId, name, req.user.id]
      );

      if (result.rows.length > 0) {
        return res.status(201).json(result.rows[0]);
      }
    }
  } catch (err) {
    res.status(500).json({ error: 'workspace creation failed' });
  }
});

// ----------------------------------------------------
// 🔗 CONNECTOR ATTACH
// ----------------------------------------------------
const ALLOWED_CONNECTORS = ['shopify', 'meta', 'google'];

app.post(
  '/workspaces/:shortId/connectors/:connector',
  requireAuth,
  async (req, res) => {
    const { shortId, connector } = req.params;

    if (!ALLOWED_CONNECTORS.includes(connector)) {
      return res.status(400).json({ error: 'invalid connector' });
    }

    const wsResult = await pool.query(
      `SELECT id
       FROM workspaces
       WHERE short_id = $1 AND owner_user_id = $2`,
      [shortId, req.user.id]
    );

    if (wsResult.rows.length === 0) {
      return res.status(404).json({ error: 'workspace not found' });
    }

    const workspaceId = wsResult.rows[0].id;
    const datasetId = `${shortId}__${connector}`;

    await ensureDataset(datasetId);
    await bindIngestSA(datasetId);

    await pool.query(
      `INSERT INTO workspace_connectors (workspace_id, connector_type, dataset_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [workspaceId, connector, datasetId]
    );

    res.json({ workspace: shortId, connector, dataset: datasetId });
  }
);

// ----------------------------------------------------
// 🛍️ SHOPIFY OAUTH START
// ----------------------------------------------------
app.get('/auth/shopify', requireAuth, async (req, res) => {
  const { shop, workspace } = req.query;

  if (!shop || !workspace) {
    return res.status(400).json({ error: 'shop and workspace required' });
  }

  // 🔒 Validate workspace ownership
  const ws = await pool.query(
    `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
    [workspace, req.user.id]
  );

  if (ws.rows.length === 0) {
    return res.status(403).json({ error: 'unauthorized workspace' });
  }

  // Pack workspace into state so Shopify sends it back to the callback
  const nonce = crypto.randomBytes(8).toString('hex');
  const state = `${nonce}:${workspace}`; 

  const authURL = buildAuthURL(shop, state);

  res.redirect(authURL);
});

// ----------------------------------------------------
// 🛍️ SHOPIFY OAUTH CALLBACK
// ----------------------------------------------------
app.get('/auth/shopify/callback', requireAuth, async (req, res) => {
  // Extract state instead of workspace from the query
  const { shop, code, state } = req.query;

  if (!shop || !code || !state) {
    return res.status(400).json({ error: 'invalid callback params' });
  }

  // Unpack workspace from state
  const [nonce, workspace] = state.split(':');

  if (!workspace) {
    return res.status(400).json({ error: 'workspace ID missing from state' });
  }

  // 🔒 Re-validate workspace ownership
  const ws = await pool.query(
    `SELECT id FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
    [workspace, req.user.id]
  );

  if (ws.rows.length === 0) {
    return res.status(403).json({ error: 'unauthorized workspace' });
  }

  const token = await exchangeCodeForToken(shop, code);

  // ✅ Store token PER WORKSPACE
  const secretRef = await storeShopifyToken(workspace, shop, token);

  await pool.query(
    `INSERT INTO shopify_stores
     (workspace_id, shop_domain, secret_ref, installed_by_user)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, shop_domain) DO NOTHING`,
    [workspace, shop, secretRef, req.user.id]
  );

  res.json({ success: true, shop });
});

// ----------------------------------------------------
// 🧾 LIST SHOPIFY STORES (DROPDOWN)
// ----------------------------------------------------
app.get('/workspaces/:id/shopify/stores', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT shop_domain, created_at
     FROM shopify_stores
     WHERE workspace_id = $1`,
    [req.params.id]
  );

  res.json(result.rows);
});

// ----------------------------------------------------
// 🚀 START SERVER
// ----------------------------------------------------
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
