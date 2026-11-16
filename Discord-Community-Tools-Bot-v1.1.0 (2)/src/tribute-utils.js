export const GBP_TO_USD_RATE = 1.27;

export function convertToUsdMinor(usdMinor, gbpMinor) {
  return Number(usdMinor) + Math.round(Number(gbpMinor) * GBP_TO_USD_RATE);
}

export function summarizeSentTotals(rows) {
  const totals = { usdMinor: 0, gbpMinor: 0, count: 0 };
  for (const row of rows) {
    if (row.currency === 'USD') totals.usdMinor += Number(row.total_minor);
    if (row.currency === 'GBP') totals.gbpMinor += Number(row.total_minor);
    totals.count += Number(row.count);
  }
  return {
    ...totals,
    convertedUsdMinor: convertToUsdMinor(totals.usdMinor, totals.gbpMinor),
  };
}

export function formatMoney(amountMinor, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amountMinor) / 100);
}
