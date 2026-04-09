// ============================================================
// src/shopify/fields.js
// Complete list of all available ShopifyQL fields
// Users pick from this list to build their export config
// ============================================================

const SHOPIFY_METRICS = [
  // ── Core Financials ────────────────────────────────────────
  { key: 'gross_sales',             label: 'Gross Sales',              category: 'Financial' },
  { key: 'discounts',               label: 'Discounts',                category: 'Financial' },
  { key: 'returns',                 label: 'Returns',                  category: 'Financial' },
  { key: 'net_sales',               label: 'Net Sales',                category: 'Financial' },
  { key: 'taxes',                   label: 'Taxes',                    category: 'Financial' },
  { key: 'shipping_charges',        label: 'Shipping Charges',         category: 'Financial' },
  { key: 'total_sales',             label: 'Total Sales',              category: 'Financial' },
  { key: 'duties',                  label: 'Duties',                   category: 'Financial' },
  { key: 'tips',                    label: 'Tips',                     category: 'Financial' },
  { key: 'refunds',                 label: 'Refunds',                  category: 'Financial' },
  { key: 'sales_reversals',         label: 'Sales Reversals',          category: 'Financial' },

  // ── Volume & Performance ────────────────────────────────────
  { key: 'orders',                  label: 'Order Count',              category: 'Volume' },
  { key: 'units_sold',              label: 'Units Sold',               category: 'Volume' },
  { key: 'average_order_value',     label: 'Average Order Value',      category: 'Volume' },
  { key: 'average_units_per_order', label: 'Avg Units Per Order',      category: 'Volume' },

  // ── Customers ───────────────────────────────────────────────
  { key: 'customers',               label: 'Customers',                category: 'Customers' },
  { key: 'new_customers',           label: 'New Customers',            category: 'Customers' },
  { key: 'returning_customers',     label: 'Returning Customers',      category: 'Customers' },

  // ── Conversion ──────────────────────────────────────────────
  { key: 'conversion_rate',         label: 'Conversion Rate',          category: 'Conversion' },
  { key: 'cart_abandonment_rate',   label: 'Cart Abandonment Rate',    category: 'Conversion' },
];

const SHOPIFY_DIMENSIONS = [
  // ── Order Info ──────────────────────────────────────────────
  { key: 'order_id',                label: 'Order ID',                 category: 'Order' },
  { key: 'order_name',              label: 'Order Name (#1001)',       category: 'Order' },
  { key: 'order_number',            label: 'Order Number',             category: 'Order' },
  { key: 'financial_status',        label: 'Financial Status',         category: 'Order' },
  { key: 'fulfillment_status',      label: 'Fulfillment Status',       category: 'Order' },
  { key: 'order_source',            label: 'Order Source',             category: 'Order' },
  { key: 'order_tags',              label: 'Order Tags',               category: 'Order' },
  { key: 'created_at',              label: 'Order Created At',         category: 'Order' },
  { key: 'processed_at',            label: 'Order Processed At',       category: 'Order' },

  // ── Product Info ────────────────────────────────────────────
  { key: 'product_id',              label: 'Product ID',               category: 'Product' },
  { key: 'product_title',           label: 'Product Title',            category: 'Product' },
  { key: 'product_type',            label: 'Product Type',             category: 'Product' },
  { key: 'product_vendor',          label: 'Product Vendor',           category: 'Product' },
  { key: 'variant_id',              label: 'Variant ID',               category: 'Product' },
  { key: 'variant_title',           label: 'Variant Title',            category: 'Product' },
  { key: 'variant_sku',             label: 'Variant SKU',              category: 'Product' },
  { key: 'collection_id',           label: 'Collection ID',            category: 'Product' },
  { key: 'collection_title',        label: 'Collection Title',         category: 'Product' },

  // ── Customer Info ────────────────────────────────────────────
  { key: 'customer_id',             label: 'Customer ID',              category: 'Customer' },
  { key: 'customer_email',          label: 'Customer Email',           category: 'Customer' },
  { key: 'customer_name',           label: 'Customer Name',            category: 'Customer' },
  { key: 'customer_tags',           label: 'Customer Tags',            category: 'Customer' },
  { key: 'customer_lifetime_orders',label: 'Customer Lifetime Orders', category: 'Customer' },
  { key: 'customer_cohort',         label: 'Customer Cohort',          category: 'Customer' },
  { key: 'is_new_customer',         label: 'Is New Customer',          category: 'Customer' },
  { key: 'is_returning_customer',   label: 'Is Returning Customer',    category: 'Customer' },

  // ── Geography ────────────────────────────────────────────────
  { key: 'billing_country',         label: 'Billing Country',          category: 'Geography' },
  { key: 'billing_region',          label: 'Billing Region',           category: 'Geography' },
  { key: 'billing_city',            label: 'Billing City',             category: 'Geography' },
  { key: 'billing_zip',             label: 'Billing Zip',              category: 'Geography' },
  { key: 'shipping_country',        label: 'Shipping Country',         category: 'Geography' },
  { key: 'shipping_region',         label: 'Shipping Region',          category: 'Geography' },
  { key: 'shipping_city',           label: 'Shipping City',            category: 'Geography' },
  { key: 'shipping_zip',            label: 'Shipping Zip',             category: 'Geography' },

  // ── Marketing ────────────────────────────────────────────────
  { key: 'utm_source',              label: 'UTM Source',               category: 'Marketing' },
  { key: 'utm_medium',              label: 'UTM Medium',               category: 'Marketing' },
  { key: 'utm_campaign',            label: 'UTM Campaign',             category: 'Marketing' },
  { key: 'utm_content',             label: 'UTM Content',              category: 'Marketing' },
  { key: 'utm_term',                label: 'UTM Term',                 category: 'Marketing' },
  { key: 'marketing_channel',       label: 'Marketing Channel',        category: 'Marketing' },
  { key: 'referring_site',          label: 'Referring Site',           category: 'Marketing' },
  { key: 'landing_site',            label: 'Landing Site',             category: 'Marketing' },

  // ── Discounts ────────────────────────────────────────────────
  { key: 'discount_code',           label: 'Discount Code',            category: 'Discounts' },
  { key: 'discount_title',          label: 'Discount Title',           category: 'Discounts' },
  { key: 'discount_type',           label: 'Discount Type',            category: 'Discounts' },
  { key: 'is_discounted_sale',      label: 'Is Discounted Sale',       category: 'Discounts' },
];

// ── Default field selection (what new workspaces start with) ──
const DEFAULT_METRICS = [
  'gross_sales', 'discounts', 'returns', 'net_sales',
  'taxes', 'shipping_charges', 'total_sales', 'orders', 'units_sold'
];

const DEFAULT_DIMENSIONS = [
  'day', 'order_id', 'order_name', 'financial_status', 'fulfillment_status'
];

// ── Valid keys for server-side validation ─────────────────────
const VALID_METRIC_KEYS     = new Set(SHOPIFY_METRICS.map(f => f.key));
const VALID_DIMENSION_KEYS  = new Set(SHOPIFY_DIMENSIONS.map(f => f.key));

// 'day' is always the primary time dimension — always included in GROUP BY
// It is not in the user-selectable list since it's mandatory
const MANDATORY_DIMENSIONS  = ['day'];

function validateFields(metrics, dimensions) {
  const badMetrics     = metrics.filter(k => !VALID_METRIC_KEYS.has(k));
  const badDimensions  = dimensions.filter(k => !VALID_DIMENSION_KEYS.has(k));

  if (badMetrics.length > 0) {
    throw new Error(`Invalid metric keys: ${badMetrics.join(', ')}`);
  }
  if (badDimensions.length > 0) {
    throw new Error(`Invalid dimension keys: ${badDimensions.join(', ')}`);
  }
}

module.exports = {
  SHOPIFY_METRICS,
  SHOPIFY_DIMENSIONS,
  DEFAULT_METRICS,
  DEFAULT_DIMENSIONS,
  MANDATORY_DIMENSIONS,
  validateFields,
};
