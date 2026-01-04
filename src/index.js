const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const pool = require('./db');

const app = express();
const port = process.env.PORT || 8080;

// Health check
app.get('/', (req, res) => {
  res.send('DataSync backend running');
});

// BigQuery permission test
app.get('/test-bq', async (req, res) => {
  try {
    const bq = new BigQuery();
    const [datasets] = await bq.getDatasets();
    res.json({
      success: true,
      datasetCount: datasets.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DB test
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      success: true,
      time: result.rows[0].now
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

//Workspace Creation
const crypto = require('crypto');
const pool = require('./db');

function generateWorkspaceShortId() {
  return 'ws_' + crypto.randomBytes(3).toString('hex');
}

app.post('/workspaces', async (req, res) => {
  const name = req.body?.name || 'Untitled Workspace';

  let shortId;
  let created = false;

  try {
    // ensure uniqueness (rare collision, but handle it)
    while (!created) {
      shortId = generateWorkspaceShortId();
      const result = await pool.query(
        `INSERT INTO workspaces (short_id, name)
         VALUES ($1, $2)
         ON CONFLICT (short_id) DO NOTHING
         RETURNING id, short_id, name`,
        [shortId, name]
      );

      if (result.rows.length > 0) {
        created = true;
        res.status(201).json(result.rows[0]);
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'workspace creation failed' });
  }
});
