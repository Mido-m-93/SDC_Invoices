import "server-only";

// Frankfurter: free, no API key, ECB reference rates. https://frankfurter.dev
const FX_API_BASE = "https://api.frankfurter.dev/v1";

export interface UsdToJpyConversion {
  amountJpy: number;
  rate: number;
  asOf: string;
}

async function fetchUsdJpyRate(path: string): Promise<{ rate: number; asOf: string } | null> {
  try {
    const res = await fetch(`${FX_API_BASE}/${path}?from=USD&to=JPY`);
    if (!res.ok) return null;
    const data = await res.json() as { date?: string; rates?: { JPY?: number } };
    const rate = data.rates?.JPY;
    if (!rate || !data.date) return null;
    return { rate, asOf: data.date };
  } catch {
    return null;
  }
}

/**
 * Converts a USD amount to JPY using the ECB reference rate for `onDate`,
 * falling back to the latest available rate if that date has none
 * (e.g. weekends, or a future billing date). Throws rather than guessing
 * if no rate can be obtained at all — this feeds a real invoice amount.
 */
export async function convertUsdToJpy(amountUsd: number, onDate: string): Promise<UsdToJpyConversion> {
  const historical = await fetchUsdJpyRate(onDate);
  const result = historical ?? await fetchUsdJpyRate("latest");

  if (!result) {
    throw new Error("[ExchangeRateService] Could not fetch USD→JPY rate — refusing to guess on a real invoice amount");
  }

  return {
    amountJpy: Math.round(amountUsd * result.rate),
    rate: result.rate,
    asOf: result.asOf,
  };
}
