// ============================================================
// jobs/shopify-sync.js
// Cloud Run Job entrypoint
// Triggered daily by Cloud Scheduler
// ============================================================

require('dotenv').config();   // no-op on Cloud Run, useful for local testing

const pool             = require('../src/db');
const { getShopifyToken }    = require('../src/shopify/secrets');
const { runShopifyIngestion } = require('../src/shopify/ingestion');
const {
  DEFAULT_METRICS,
  DEFAULT_DIMENSIONS,
} = require('../src/shopify/fields');

// ── Allow targeting a single workspace via env var ────────────
// Cloud Scheduler can override: set WORKSPACE_ID env on the job
const TARGET_WORKSPACE = process.env.TARGET_WORKSPACE_ID
  ? parseInt(process.env.TARGET_WORKSPACE_ID, 10)
  : null;

async function main() {
  console.log('[Job] Shopify sync started');

  // 1. Find all workspaces with active Shopify stores
  let storesQuery = `
    SELECT
      ss.workspace_id,
      ss.shop_domain,
      wc.dataset_id,
      COALESCE(cfc.selected_metrics,    $1::text[]) AS metrics,
      COALESCE(cfc.selected_dimensions, $2::text[]) AS dimensions
    FROM shopify_stores ss
    JOIN workspace_connectors wc
      ON wc.workspace_id = ss.workspace_id AND wc.connector_type = 'shopify'
    LEFT JOIN connector_field_configs cfc
      ON cfc.workspace_id = ss.workspace_id AND cfc.connector_type = 'shopify'
  `;

  const params = [DEFAULT_METRICS, DEFAULT_DIMENSIONS];

  if (TARGET_WORKSPACE) {
    storesQuery += ` WHERE ss.workspace_id = $3`;
    params.push(TARGET_WORKSPACE);
  }

  const { rows: stores } = await pool.query(storesQuery, params);

  console.log(`[Job] Found ${stores.length} store(s) to sync`);

  // 2. Process each store sequentially (avoids hammering Shopify API)
  for (const store of stores) {
    const { workspace_id, shop_domain, dataset_id, metrics, dimensions } = store;

    // Insert a running log entry
    const { rows: [log] } = await pool.query(
      `INSERT INTO sync_logs
         (workspace_id, connector_type, shop_domain, status, started_at)
       VALUES ($1, 'shopify', $2, 'running', NOW())
       RETURNING id`,
      [workspace_id, shop_domain]
    );
    const logId = log.id;

    try {
      // Retrieve token from Secret Manager
      const accessToken = await getShopifyToken(workspace_id, shop_domain);

      // Run ingestion
      const { rowsWritten, sinceDate, untilDate } = await runShopifyIngestion({
        workspaceId:  workspace_id,
        datasetId:    dataset_id,
        shopDomain:   shop_domain,
        accessToken,
        metrics,
        dimensions,
      });

      // Mark success
      await pool.query(
        `UPDATE sync_logs
         SET status = 'success', rows_written = $1, finished_at = NOW()
         WHERE id = $2`,
        [rowsWritten, logId]
      );

      // Update last_synced_at on the store record
      await pool.query(
        `UPDATE shopify_stores SET last_synced_at = NOW()
         WHERE workspace_id = $1 AND shop_domain = $2`,
        [workspace_id, shop_domain]
      );

      console.log(`[Job] ✅ ${shop_domain} → ${rowsWritten} rows (${sinceDate} → ${untilDate})`);

    } catch (err) {
      console.error(`[Job] ❌ ${shop_domain} failed:`, err.message);

      await pool.query(
        `UPDATE sync_logs
         SET status = 'failed', error_message = $1, finished_at = NOW()
         WHERE id = $2`,
        [err.message, logId]
      );
    }
  }

  console.log('[Job] Shopify sync complete');
  await pool.end();
  process.exit(0);
}

main().catch(async err => {
  console.error('[Job] Fatal error:', err);
  await pool.end();
  process.exit(1);
});
