// ============================================================
// src/shopify/ingestion.js
// Core ingestion logic: ShopifyQL → BigQuery
// ============================================================

const fetch   = require('node-fetch');
const { BigQuery } = require('@google-cloud/bigquery');

const bq = new BigQuery();

// ── Build a ShopifyQL query from saved field config ───────────
function buildShopifyQLQuery(metrics, dimensions, sinceDate, untilDate) {
  // 'day' is always the first dimension (mandatory time grouping)
  const allDimensions = ['day', ...dimensions.filter(d => d !== 'day')];

  const showFields  = [...metrics, ...allDimensions].join(',\n        ');
  const groupFields = allDimensions.join(', ');

  return `
    FROM sales
      SHOW
        ${showFields}
      GROUP BY ${groupFields}
      SINCE ${sinceDate}
      UNTIL ${untilDate}
      ORDER BY day ASC
  `.trim();
}

// ── Execute a ShopifyQL query against a store ─────────────────
async function executeShopifyQL(shopDomain, accessToken, shopifyqlQuery) {
  const graphqlQuery = `
    query ($q: String!) {
      shopifyqlQuery(query: $q) {
        tableData {
          columns { name dataType displayName }
          rows
        }
        parseErrors
      }
    }
  `;

  const url = `https://${shopDomain}/admin/api/${process.env.SHOPIFY_API_VERSION || '2026-04'}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { q: shopifyqlQuery },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const result = data.data.shopifyqlQuery;

  if (result.parseErrors && result.parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse errors: ${JSON.stringify(result.parseErrors)}`);
  }

  return result.tableData;
}

// ── Convert ShopifyQL tableData rows into BQ-ready row objects ─
function tableDataToRows(tableData, shopDomain, workspaceId) {
  const { columns, rows } = tableData;

  if (!rows || rows.length === 0) return [];

  const colNames = columns.map(c => c.name);
  const colTypes = columns.map(c => c.dataType);

  return rows.map(row => {
    const obj = {
      _ingested_at: new Date().toISOString(),
      _shop_domain:  shopDomain,
      _workspace_id: String(workspaceId),
    };

    colNames.forEach((name, i) => {
      const val  = row[i];
      const type = colTypes[i];

      if (val === null || val === undefined || val === '') {
        obj[name] = null;
        return;
      }

      // Coerce types based on ShopifyQL dataType hints
      if (type === 'Int' || type === 'Float' || type === 'Money') {
        obj[name] = Number(val) || 0;
      } else if (type === 'Boolean') {
        obj[name] = val === true || val === 'true';
      } else {
        obj[name] = String(val);
      }
    });

    return obj;
  });
}

// ── Derive a BigQuery schema from the columns returned ────────
function deriveSchema(tableData) {
  const typeMap = {
    'Int':     'INTEGER',
    'Float':   'FLOAT',
    'Money':   'FLOAT',
    'Boolean': 'BOOLEAN',
    'Date':    'DATE',
    'DateTime':'TIMESTAMP',
    'String':  'STRING',
  };

  const base = tableData.columns.map(col => ({
    name: col.name,
    type: typeMap[col.dataType] || 'STRING',
    mode: 'NULLABLE',
  }));

  // Metadata columns we always attach
  return [
    ...base,
    { name: '_ingested_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: '_shop_domain',  type: 'STRING',    mode: 'REQUIRED' },
    { name: '_workspace_id', type: 'STRING',    mode: 'REQUIRED' },
  ];
}

// ── Write rows to BigQuery (replace today's partition) ────────
async function writeToBigQuery(datasetId, tableId, schema, rows) {
  if (rows.length === 0) {
    console.log(`[BQ] No rows to write for ${datasetId}.${tableId}`);
    return 0;
  }

  const dataset = bq.dataset(datasetId);
  const table   = dataset.table(tableId);

  // Create or update table
  const [exists] = await table.exists();

  if (!exists) {
    await table.create({
      schema,
      timePartitioning: {
        type:  'DAY',
        field: 'day',        // partition by the sale date
      },
      requirePartitionFilter: false,
    });
    console.log(`[BQ] Created table ${datasetId}.${tableId}`);
  }

  // Insert rows in batches of 500 to stay under BQ streaming limits
  const BATCH = 500;
  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await table.insert(batch, { skipInvalidRows: false, ignoreUnknownValues: true });
    totalInserted += batch.length;
  }

  console.log(`[BQ] Inserted ${totalInserted} rows into ${datasetId}.${tableId}`);
  return totalInserted;
}

// ── MAIN: run ingestion for one workspace + store ─────────────
async function runShopifyIngestion({ workspaceId, datasetId, shopDomain, accessToken, metrics, dimensions }) {
  // Always last 30 days
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const fmt   = d => d.toISOString().split('T')[0];
  const sinceDate = fmt(since);
  const untilDate = fmt(until);

  console.log(`[Ingestion] workspace=${workspaceId} shop=${shopDomain} range=${sinceDate}→${untilDate}`);

  // 1. Build and execute ShopifyQL query
  const query     = buildShopifyQLQuery(metrics, dimensions, sinceDate, untilDate);
  const tableData = await executeShopifyQL(shopDomain, accessToken, query);

  // 2. Convert to rows
  const rows   = tableDataToRows(tableData, shopDomain, workspaceId);
  const schema = deriveSchema(tableData);

  // 3. Write to BigQuery
  // Table name: shopify_sales (always same table, partitioned by day)
  const rowsWritten = await writeToBigQuery(datasetId, 'shopify_sales', schema, rows);

  return { rowsWritten, sinceDate, untilDate };
}

module.exports = { runShopifyIngestion };
