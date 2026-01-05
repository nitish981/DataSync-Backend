const { BigQuery } = require('@google-cloud/bigquery');

const bq = new BigQuery();

/**
 * Ensure dataset exists
 * Called when a connector is attached to a workspace
 */
async function ensureDataset(datasetId) {
  const dataset = bq.dataset(datasetId);
  const [exists] = await dataset.exists();

  if (!exists) {
    await bq.createDataset(datasetId, {
      location: 'US', // storage location, NOT client location
      labels: {
        managed_by: 'datapilot',
        type: 'connector'
      }
    });
  }
}

/**
 * Bind ingest service account at dataset level
 */
async function bindIngestSA(datasetId) {
  const dataset = bq.dataset(datasetId);
  const [policy] = await dataset.iam.getPolicy();

  const role = 'roles/bigquery.dataEditor';
  const member = 'serviceAccount:ingest-sa@datapilot.iam.gserviceaccount.com';

  let binding = policy.bindings.find(b => b.role === role);
  if (!binding) {
    binding = { role, members: [] };
    policy.bindings.push(binding);
  }

  if (!binding.members.includes(member)) {
    binding.members.push(member);
  }

  await dataset.iam.setPolicy(policy);
}

module.exports = {
  ensureDataset,
  bindIngestSA
};
