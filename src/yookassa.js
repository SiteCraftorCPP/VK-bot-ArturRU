const crypto = require('node:crypto');
const { formatAmount, getPaymentConfig } = require('./payments');

const API_URL = 'https://api.yookassa.ru/v3';

function getAuthHeader(config) {
  const token = Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64');
  return `Basic ${token}`;
}

async function apiRequest(method, path, body, idempotenceKey) {
  const config = getPaymentConfig();
  const headers = {
    Authorization: getAuthHeader(config),
    'Content-Type': 'application/json',
  };

  if (idempotenceKey) {
    headers['Idempotence-Key'] = idempotenceKey;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.description || data?.type || response.statusText;
    throw new Error(`YooKassa API ${response.status}: ${message}`);
  }

  return data;
}

async function createPayment({ userId, product, amount, description }) {
  const config = getPaymentConfig();
  const idempotenceKey = crypto.randomUUID();

  const payment = await apiRequest('POST', '/payments', {
    amount: {
      value: formatAmount(amount),
      currency: 'RUB',
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: config.returnUrl,
    },
    description,
    metadata: {
      user_id: String(userId),
      product,
    },
  }, idempotenceKey);

  return {
    id: payment.id,
    status: payment.status,
    confirmationUrl: payment.confirmation?.confirmation_url || '',
    amount: payment.amount?.value,
    metadata: payment.metadata || {},
  };
}

async function fetchPayment(paymentId) {
  const payment = await apiRequest('GET', `/payments/${paymentId}`);
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    metadata: payment.metadata || {},
    description: payment.description || '',
  };
}

module.exports = {
  createPayment,
  fetchPayment,
};
