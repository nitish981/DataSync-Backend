const crypto = require('crypto');
const fetch = require('node-fetch');

function buildAuthURL(shop, state) {
  const scopes = [
    'read_orders',
    'read_customers',
    'read_products',
    'read_analytics'
  ].join(',');

  return `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_CLIENT_ID}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(process.env.SHOPIFY_REDIRECT_URI)}` +
    `&state=${state}`;
}

async function exchangeCodeForToken(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code
    })
  });

  if (!res.ok) throw new Error('Token exchange failed');
  return res.json();
}

module.exports = {
  buildAuthURL,
  exchangeCodeForToken
};
