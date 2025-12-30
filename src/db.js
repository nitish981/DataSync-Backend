const { Pool } = require('pg');
const fs = require('fs');

// --- START SANITY CHECK ---
const socketDir = process.env.DB_HOST;
console.log("--- DEBUG: Pre-Connection Check ---");
console.log("Target Socket Directory:", socketDir);

try {
  if (socketDir && socketDir.startsWith('/cloudsql')) {
    if (fs.existsSync(socketDir)) {
      const files = fs.readdirSync(socketDir);
      console.log("✅ Directory exists. Contents:", files);
      if (files.length === 0) {
        console.warn("⚠️ WARNING: Directory is EMPTY. Cloud SQL connection might not be enabled in Cloud Run settings.");
      }
    } else {
      console.error("❌ ERROR: The directory /cloudsql/... does not exist at all.");
    }
  } else {
    console.log("ℹ️ Not using a Unix socket path (Local development mode).");
  }
} catch (e) {
  console.error("❌ ERROR: Failed to read socket directory:", e.message);
}
console.log("--- END DEBUG ---");
// --- END SANITY CHECK ---

const poolConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST, 
  port: 5432,
  ssl: false, 
};

const pool = new Pool(poolConfig);

module.exports = pool;
