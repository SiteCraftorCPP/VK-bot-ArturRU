function formatAmount(rub) {
  return Number(rub).toFixed(2);
}

function getPaymentConfig() {
  return {
    shopId: String(process.env.YOOKASSA_SHOP_ID || '').trim(),
    secretKey: String(process.env.YOOKASSA_SECRET_KEY || '').trim(),
    testMode: String(process.env.YOOKASSA_TEST_MODE || 'true').toLowerCase() !== 'false',
    subscriptionAmountRub: Number(process.env.SUBSCRIPTION_AMOUNT || 600),
    boostAmountRub: Number(process.env.BOOST_AMOUNT || 1200),
    subscriptionDays: Number(process.env.SUBSCRIPTION_DAYS || 30),
    boostDays: Number(process.env.BOOST_DAYS || 30),
    subscriptionDescription: process.env.PAYMENT_SUBSCRIPTION_DESCRIPTION || 'Доступ к боту 30 дней',
    boostDescription: process.env.PAYMENT_BOOST_DESCRIPTION || 'Поднятие анкеты в топ на 30 дней',
    returnUrl: process.env.YOOKASSA_RETURN_URL || 'https://vk.com',
    webhookPort: Number(process.env.WEBHOOK_PORT || 3001),
    webhookPath: process.env.WEBHOOK_PATH || '/yookassa/webhook',
  };
}

function isPaymentConfigured(config = getPaymentConfig()) {
  return Boolean(config.shopId && config.secretKey);
}

function getProductAmount(product, config = getPaymentConfig()) {
  return product === 'boost' ? config.boostAmountRub : config.subscriptionAmountRub;
}

function getProductDescription(product, config = getPaymentConfig()) {
  return product === 'boost' ? config.boostDescription : config.subscriptionDescription;
}

function extendUntil(currentUntil, days) {
  const now = Date.now();
  const base = currentUntil && new Date(currentUntil).getTime() > now
    ? new Date(currentUntil).getTime()
    : now;
  const until = new Date(base);
  until.setDate(until.getDate() + days);
  return until.toISOString();
}

module.exports = {
  extendUntil,
  formatAmount,
  getPaymentConfig,
  getProductAmount,
  getProductDescription,
  isPaymentConfigured,
};
