const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

async function storeShopifyToken(workspaceId, shop, token) {
  const secretId = `shopify-${workspaceId}-${shop.replace(/\./g, '-')}`;

  const [secret] = await client.createSecret({
    parent: `projects/${process.env.GCP_PROJECT}`,
    secretId,
    secret: { replication: { automatic: {} } }
  });

  await client.addSecretVersion({
    parent: secret.name,
    payload: { data: Buffer.from(JSON.stringify(token)) }
  });

  return secret.name;
}

module.exports = { storeShopifyToken };
