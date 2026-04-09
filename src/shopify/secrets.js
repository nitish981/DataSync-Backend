// ============================================================
// src/shopify/secrets.js  (UPDATED — add getShopifyToken)
// ============================================================
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

// ── Store a new token (existing function — unchanged) ─────────
async function storeShopifyToken(workspaceId, shop, token) {
  const secretId = `shopify-${workspaceId}-${shop.replace(/\./g, '-')}`;

  // createSecret fails if it already exists → try to reuse
  let secretName;
  try {
    const [secret] = await client.createSecret({
      parent: `projects/${process.env.GCP_PROJECT}`,
      secretId,
      secret: { replication: { automatic: {} } },
    });
    secretName = secret.name;
  } catch (err) {
    // Already exists (code 6 = ALREADY_EXISTS)
    if (err.code === 6) {
      secretName = `projects/${process.env.GCP_PROJECT}/secrets/${secretId}`;
    } else {
      throw err;
    }
  }

  await client.addSecretVersion({
    parent: secretName,
    payload: { data: Buffer.from(JSON.stringify(token)) },
  });

  return secretName;
}

// ── Retrieve a token for a workspace + shop ───────────────────
async function getShopifyToken(workspaceId, shop) {
  const secretId   = `shopify-${workspaceId}-${shop.replace(/\./g, '-')}`;
  const secretPath = `projects/${process.env.GCP_PROJECT}/secrets/${secretId}/versions/latest`;

  const [version] = await client.accessSecretVersion({ name: secretPath });
  const raw       = version.payload.data.toString('utf8');
  const parsed    = JSON.parse(raw);

  // token may be stored as { access_token: '...' } or as a plain string
  return typeof parsed === 'string' ? parsed : parsed.access_token;
}

module.exports = { storeShopifyToken, getShopifyToken };
