const express = require('express');
const crypto = require('crypto'); // Moved to top
const { BigQuery } = require('@google-cloud/bigquery');
const pool = require('./db');

const app = express();
const port = process.env.PORT || 8080;
const { ensureDataset, bindIngestSA } = require('./bigquery');
const ALLOWED_CONNECTORS = ['shopify', 'meta', 'google'];


// CRITICAL: This allows Express to read JSON data in POST requests
app.use(express.json()); 

// Health check
app.get('/', (req, res) => {
  res.send('DataSync backend running');
});

// BigQuery permission test
app.get('/test-bq', async (req, res) => {
  try {
    const bq = new BigQuery();
    const [datasets] = await bq.getDatasets();
    res.json({ success: true, datasetCount: datasets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DB test
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Workspace Helpers
function generateWorkspaceShortId() {
  return 'ws_' + crypto.randomBytes(3).toString('hex');
}

// Workspace Creation
app.post('/workspaces', async (req, res) => {
  const name = req.body?.name || 'Untitled Workspace';
  let created = false;

  try {
    while (!created) {
      const shortId = generateWorkspaceShortId();
      const result = await pool.query(
        `INSERT INTO workspaces (short_id, name)
         VALUES ($1, $2)
         ON CONFLICT (short_id) DO NOTHING
         RETURNING id, short_id, name`,
        [shortId, name]
      );

      if (result.rows.length > 0) {
        created = true;
        return res.status(201).json(result.rows[0]);
      }
      // If result.rows.length is 0, the loop runs again with a new ID
    }
  } catch (err) {
    console.error("Workspace Creation Error:", err);
    res.status(500).json({ error: 'workspace creation failed' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
