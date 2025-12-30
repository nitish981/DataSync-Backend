const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');

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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
const pool = require('./db');

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

