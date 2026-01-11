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
        managed_by: 'datasync',
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

  const [metadata] = await dataset.getMetadata();
  const access = metadata.access || [];

  const ingestSaEmail = 'ingest-template-sa@project-c231bbd5-840a-4e3a-b06.iam.gserviceaccount.com';

  const alreadyExists = access.some(
    entry =>
      entry.role === 'WRITER' &&
      entry.userByEmail === ingestSaEmail
  );

  if (!alreadyExists) {
    access.push({
      role: 'WRITER',
      userByEmail: ingestSaEmail
    });

    await dataset.setMetadata({ access });
  }
}



module.exports = {
  ensureDataset,
  bindIngestSA
};
