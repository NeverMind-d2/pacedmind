export type Market = { code: string; name: string; currency: string; locale: string; amount: number };

/** "$12.99", "26,99 zł", "￥1,080": the price as people in that country write it. */
export function formatPrice({ amount, currency, locale }: Market) {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

// Time zones of the countries in prices.json. The time zone says where someone is more reliably
// than the browser language, which is often English wherever they live.
const ZONES: Record<string, string> = {
  "America/New_York": "US", "America/Detroit": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Boise": "US", "America/Phoenix": "US", "America/Los_Angeles": "US", "America/Anchorage": "US",
  "America/Juneau": "US", "America/Adak": "US", "Pacific/Honolulu": "US",
  "America/Toronto": "CA", "America/Montreal": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Regina": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
  "America/Moncton": "CA", "America/Whitehorse": "CA",
  "America/Mexico_City": "MX", "America/Monterrey": "MX", "America/Cancun": "MX", "America/Merida": "MX",
  "America/Chihuahua": "MX", "America/Hermosillo": "MX", "America/Mazatlan": "MX", "America/Tijuana": "MX",
  "America/Sao_Paulo": "BR", "America/Bahia": "BR", "America/Fortaleza": "BR", "America/Recife": "BR",
  "America/Belem": "BR", "America/Manaus": "BR", "America/Cuiaba": "BR", "America/Campo_Grande": "BR",
  "America/Porto_Velho": "BR", "America/Rio_Branco": "BR",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Busingen": "DE",
  "Europe/Vienna": "AT", "Europe/Zurich": "CH", "Europe/Paris": "FR", "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL", "Europe/Madrid": "ES", "Atlantic/Canary": "ES", "Africa/Ceuta": "ES",
  "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT", "Europe/Rome": "IT",
  "Europe/Warsaw": "PL", "Europe/Prague": "CZ", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI",
  "Pacific/Auckland": "NZ", "Pacific/Chatham": "NZ", "Asia/Tokyo": "JP", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
};
const ZONE_PREFIXES: [string, string][] = [
  ["Australia/", "AU"], ["America/Indiana/", "US"], ["America/Kentucky/", "US"], ["America/North_Dakota/", "US"],
];

/** The visitor's likely country: from the time zone, then the browser languages. */
export function guessCountry(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const country = ZONES[zone] ?? ZONE_PREFIXES.find(([prefix]) => zone.startsWith(prefix))?.[1];
    if (country) return country;
  } catch {
    // Fall back to the language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    try {
      const region = new Intl.Locale(tag).maximize().region;
      if (region) return region;
    } catch {
      // An unusual language tag; try the next one.
    }
  }
  return undefined;
}
