const express = require('express');
const crypto = require('crypto');
const session = require('express-session');
const passport = require('./auth');
const { BigQuery } = require('@google-cloud/bigquery');

const pool = require('./db');
const { requireAuth } = require('./middleware');
const { ensureDataset, bindIngestSA } = require('./bigquery');

const app = express();
const port = process.env.PORT || 8080;

// ----------------------------------------------------
// 🔐 SESSION + PASSPORT (MUST BE BEFORE ROUTES)
// ----------------------------------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ----------------------------------------------------
// 🧩 MIDDLEWARE
// ----------------------------------------------------
app.use(express.json());

// ----------------------------------------------------
// 🔐 AUTH ROUTES
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
    console.error(err);
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
// 🏢 CREATE WORKSPACE (OWNER BOUND)
// ----------------------------------------------------
app.post('/workspaces', requireAuth, async (req, res) => {
  const name = req.body?.name || 'Untitled Workspace';
  let created = false;

  try {
    while (!created) {
      const shortId = generateWorkspaceShortId();

      const result = await pool.query(
        `INSERT INTO workspaces (short_id, name, owner_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (short_id) DO NOTHING
         RETURNING id, short_id, name`,
        [
          shortId,
          name,
          req.user.id // ✅ OWNER IS PASSED HERE
        ]
      );

      if (result.rows.length > 0) {
        created = true;
        return res.status(201).json(result.rows[0]);
      }
    }
  } catch (err) {
    console.error('Workspace Creation Error:', err);
    res.status(500).json({ error: 'workspace creation failed' });
  }
});

// ----------------------------------------------------
// 🔗 CONNECTOR ATTACH (SECURE + MULTI-TENANT SAFE)
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

    try {
      // 🔒 Enforce workspace ownership
      const wsResult = await pool.query(
  'SELECT id FROM workspaces WHERE short_id = $1 AND owner_user_id = $2',
  [shortId, req.user.id]
);


      if (wsResult.rows.length === 0) {
        return res.status(404).json({ error: 'workspace not found' });
      }

      const workspaceId = wsResult.rows[0].id;

      // Prevent duplicate connector
      const existing = await pool.query(
        `SELECT 1
         FROM workspace_connectors
         WHERE workspace_id = $1 AND connector_type = $2`,
        [workspaceId, connector]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'connector already added' });
      }

      // Create dataset
      const datasetId = `${shortId}__${connector}`;
      await ensureDataset(datasetId);

      // Bind ingest SA
      await bindIngestSA(datasetId);

      // Persist mapping
      await pool.query(
        `INSERT INTO workspace_connectors (workspace_id, connector_type, dataset_id)
         VALUES ($1, $2, $3)`,
        [workspaceId, connector, datasetId]
      );

      res.status(201).json({
        workspace: shortId,
        connector,
        dataset: datasetId
      });
    } catch (err) {
      console.error('Connector Attach Error:', err);
      res.status(500).json({ error: 'connector setup failed' });
    }
  }
);

// ----------------------------------------------------
// 🚀 START SERVER
// ----------------------------------------------------
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
