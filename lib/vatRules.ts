// ─── lib/vatRules.ts ──────────────────────────────────────────────────────────
// Master VAT / GST / digital services tax rules for B2C digital services
// sold by a UK sole trader to global consumers.
//
// This is the single source of truth for all tax rules.
// Update this file when tax laws change — everything else reads from it.
//
// Last reviewed: March 2026
// Sources: HMRC, EU VAT Directive, ATO, CRA, OECD BEPS Action 1

export type Jurisdiction =
  | "UK"
  | "EU_OSS"
  | "AU"
  | "CA"
  | "NO"
  | "NZ"
  | "CH"
  | "JP"
  | "KR"
  | "TW"
  | "SA"
  | "AE"
  | "TR"
  | "MX"
  | "CL"
  | "CO"
  | "AR"
  | "IL"
  | "NONE"
  | "BLOCKED";

export type TaxObligation = "immediate" | "threshold" | "none" | "blocked";

export type CountryRule = {
  countryCode:       string;       // ISO 3166-1 alpha-2
  countryName:       string;
  jurisdiction:      Jurisdiction; // which tax authority group
  obligation:        TaxObligation;
  vatRate:           number;       // 0.20 = 20%. For EU_OSS countries this is
                                   // the country-specific rate once OSS threshold hit
  taxName:           string;       // "VAT", "GST", "JCT" etc.
  taxAuthority:      string;       // HMRC, EU OSS, ATO etc.
  thresholdAmount:   number | null; // null = no threshold (immediate)
  thresholdCurrency: string | null; // null = no threshold
  notes:             string;
};

// ─── EU country VAT rates (used once OSS threshold is crossed) ────────────────
// Source: European Commission VAT rates database, 2026
export const EU_VAT_RATES: Record<string, number> = {
  AT: 0.20, // Austria
  BE: 0.21, // Belgium
  BG: 0.20, // Bulgaria
  CY: 0.19, // Cyprus
  CZ: 0.21, // Czech Republic
  DE: 0.19, // Germany
  DK: 0.25, // Denmark
  EE: 0.22, // Estonia
  ES: 0.21, // Spain
  FI: 0.255,// Finland
  FR: 0.20, // France
  GR: 0.24, // Greece
  HR: 0.25, // Croatia
  HU: 0.27, // Hungary
  IE: 0.23, // Ireland
  IT: 0.22, // Italy
  LT: 0.21, // Lithuania
  LU: 0.17, // Luxembourg
  LV: 0.21, // Latvia
  MT: 0.18, // Malta
  NL: 0.21, // Netherlands
  PL: 0.23, // Poland
  PT: 0.23, // Portugal
  RO: 0.19, // Romania
  SE: 0.25, // Sweden
  SI: 0.22, // Slovenia
  SK: 0.23, // Slovakia
};

// EU country names
export const EU_COUNTRY_NAMES: Record<string, string> = {
  AT: "Austria",       BE: "Belgium",      BG: "Bulgaria",
  CY: "Cyprus",        CZ: "Czech Republic", DE: "Germany",
  DK: "Denmark",       EE: "Estonia",      ES: "Spain",
  FI: "Finland",       FR: "France",       GR: "Greece",
  HR: "Croatia",       HU: "Hungary",      IE: "Ireland",
  IT: "Italy",         LT: "Lithuania",    LU: "Luxembourg",
  LV: "Latvia",        MT: "Malta",        NL: "Netherlands",
  PL: "Poland",        PT: "Portugal",     RO: "Romania",
  SE: "Sweden",        SI: "Slovenia",     SK: "Slovakia",
};

export const EU_COUNTRY_CODES = new Set(Object.keys(EU_VAT_RATES));

// ─── Blocked countries ────────────────────────────────────────────────────────
export const BLOCKED_COUNTRIES = new Set(["RU", "BY"]);

// ─── Full country rules map ───────────────────────────────────────────────────

export const COUNTRY_RULES: Record<string, CountryRule> = {

  // ── BLOCKED ───────────────────────────────────────────────────────────────
  RU: {
    countryCode: "RU", countryName: "Russia",
    jurisdiction: "BLOCKED", obligation: "blocked",
    vatRate: 0, taxName: "VAT", taxAuthority: "FNS Russia",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Service blocked — sanctioned country"
  },
  BY: {
    countryCode: "BY", countryName: "Belarus",
    jurisdiction: "BLOCKED", obligation: "blocked",
    vatRate: 0, taxName: "VAT", taxAuthority: "MNS Belarus",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Service blocked — sanctioned country"
  },

  // ── UK ────────────────────────────────────────────────────────────────────
  GB: {
    countryCode: "GB", countryName: "United Kingdom",
    jurisdiction: "UK", obligation: "threshold",
    vatRate: 0.20, taxName: "VAT", taxAuthority: "HMRC",
    thresholdAmount: 90000, thresholdCurrency: "GBP",
    notes: "UK VAT threshold £90,000 trailing 12 months. Quarterly returns to HMRC."
  },

  // ── EU (27 member states — all under OSS scheme) ──────────────────────────
  AT: {
    countryCode: "AT", countryName: "Austria",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.AT, taxName: "MwSt", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 20%."
  },
  BE: {
    countryCode: "BE", countryName: "Belgium",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.BE, taxName: "BTW/TVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  BG: {
    countryCode: "BG", countryName: "Bulgaria",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.BG, taxName: "ДДС", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 20%."
  },
  CY: {
    countryCode: "CY", countryName: "Cyprus",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.CY, taxName: "ΦΠΑ", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 19%."
  },
  CZ: {
    countryCode: "CZ", countryName: "Czech Republic",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.CZ, taxName: "DPH", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  DE: {
    countryCode: "DE", countryName: "Germany",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.DE, taxName: "MwSt", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 19%."
  },
  DK: {
    countryCode: "DK", countryName: "Denmark",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.DK, taxName: "Moms", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 25%."
  },
  EE: {
    countryCode: "EE", countryName: "Estonia",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.EE, taxName: "Käibemaks", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 22%."
  },
  ES: {
    countryCode: "ES", countryName: "Spain",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.ES, taxName: "IVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  FI: {
    countryCode: "FI", countryName: "Finland",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.FI, taxName: "ALV", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 25.5%."
  },
  FR: {
    countryCode: "FR", countryName: "France",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.FR, taxName: "TVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 20%."
  },
  GR: {
    countryCode: "GR", countryName: "Greece",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.GR, taxName: "ΦΠΑ", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 24%."
  },
  HR: {
    countryCode: "HR", countryName: "Croatia",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.HR, taxName: "PDV", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 25%."
  },
  HU: {
    countryCode: "HU", countryName: "Hungary",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.HU, taxName: "ÁFA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 27%."
  },
  IE: {
    countryCode: "IE", countryName: "Ireland",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.IE, taxName: "VAT", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 23%."
  },
  IT: {
    countryCode: "IT", countryName: "Italy",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.IT, taxName: "IVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 22%."
  },
  LT: {
    countryCode: "LT", countryName: "Lithuania",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.LT, taxName: "PVM", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  LU: {
    countryCode: "LU", countryName: "Luxembourg",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.LU, taxName: "TVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 17%."
  },
  LV: {
    countryCode: "LV", countryName: "Latvia",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.LV, taxName: "PVN", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  MT: {
    countryCode: "MT", countryName: "Malta",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.MT, taxName: "VAT", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 18%."
  },
  NL: {
    countryCode: "NL", countryName: "Netherlands",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.NL, taxName: "BTW", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 21%."
  },
  PL: {
    countryCode: "PL", countryName: "Poland",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.PL, taxName: "VAT", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 23%."
  },
  PT: {
    countryCode: "PT", countryName: "Portugal",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.PT, taxName: "IVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 23%."
  },
  RO: {
    countryCode: "RO", countryName: "Romania",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.RO, taxName: "TVA", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 19%."
  },
  SE: {
    countryCode: "SE", countryName: "Sweden",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.SE, taxName: "Moms", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 25%."
  },
  SI: {
    countryCode: "SI", countryName: "Slovenia",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.SI, taxName: "DDV", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 22%."
  },
  SK: {
    countryCode: "SK", countryName: "Slovakia",
    jurisdiction: "EU_OSS", obligation: "threshold",
    vatRate: EU_VAT_RATES.SK, taxName: "DPH", taxAuthority: "EU OSS via HMRC",
    thresholdAmount: 10000, thresholdCurrency: "EUR",
    notes: "Part of EU OSS combined threshold €10,000. Rate: 23%."
  },

  // ── THRESHOLD-BASED (non-EU) ──────────────────────────────────────────────
  AU: {
    countryCode: "AU", countryName: "Australia",
    jurisdiction: "AU", obligation: "threshold",
    vatRate: 0.10, taxName: "GST", taxAuthority: "Australian ATO",
    thresholdAmount: 75000, thresholdCurrency: "AUD",
    notes: "Australian GST threshold AUD $75,000. Register with ATO."
  },
  CA: {
    countryCode: "CA", countryName: "Canada",
    jurisdiction: "CA", obligation: "threshold",
    vatRate: 0.05, taxName: "GST", taxAuthority: "Canada CRA",
    thresholdAmount: 30000, thresholdCurrency: "CAD",
    notes: "Canadian GST threshold CAD $30,000. Rate 5% federal. Provincial rates may apply."
  },
  NO: {
    countryCode: "NO", countryName: "Norway",
    jurisdiction: "NO", obligation: "threshold",
    vatRate: 0.25, taxName: "MVA", taxAuthority: "Norway VOEC",
    thresholdAmount: 50000, thresholdCurrency: "NOK",
    notes: "Norwegian VOEC scheme threshold NOK 50,000. Register via VOEC."
  },
  NZ: {
    countryCode: "NZ", countryName: "New Zealand",
    jurisdiction: "NZ", obligation: "threshold",
    vatRate: 0.15, taxName: "GST", taxAuthority: "New Zealand IRD",
    thresholdAmount: 60000, thresholdCurrency: "NZD",
    notes: "NZ GST threshold NZD $60,000. Register with Inland Revenue."
  },
  CH: {
    countryCode: "CH", countryName: "Switzerland",
    jurisdiction: "CH", obligation: "threshold",
    vatRate: 0.081, taxName: "MWST", taxAuthority: "Switzerland FTA",
    thresholdAmount: 100000, thresholdCurrency: "CHF",
    notes: "Swiss VAT threshold CHF 100,000. Register with Federal Tax Administration."
  },

  // ── IMMEDIATE VAT (no threshold) ──────────────────────────────────────────
  JP: {
    countryCode: "JP", countryName: "Japan",
    jurisdiction: "JP", obligation: "immediate",
    vatRate: 0.10, taxName: "JCT", taxAuthority: "Japan NTA",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Japanese Consumption Tax applies from first sale. No threshold for foreign digital services."
  },
  KR: {
    countryCode: "KR", countryName: "South Korea",
    jurisdiction: "KR", obligation: "immediate",
    vatRate: 0.10, taxName: "VAT", taxAuthority: "South Korea NTS",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Korean VAT applies from first sale. Register with National Tax Service."
  },
  TW: {
    countryCode: "TW", countryName: "Taiwan",
    jurisdiction: "TW", obligation: "immediate",
    vatRate: 0.05, taxName: "VAT", taxAuthority: "Taiwan MOF",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Taiwan VAT applies from first sale. Register with Ministry of Finance."
  },
  SA: {
    countryCode: "SA", countryName: "Saudi Arabia",
    jurisdiction: "SA", obligation: "immediate",
    vatRate: 0.15, taxName: "VAT", taxAuthority: "Saudi Arabia ZATCA",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Saudi VAT applies from first sale. Register with ZATCA."
  },
  AE: {
    countryCode: "AE", countryName: "United Arab Emirates",
    jurisdiction: "AE", obligation: "immediate",
    vatRate: 0.05, taxName: "VAT", taxAuthority: "UAE FTA",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "UAE VAT applies from first sale. Register with Federal Tax Authority."
  },
  TR: {
    countryCode: "TR", countryName: "Turkey",
    jurisdiction: "TR", obligation: "immediate",
    vatRate: 0.20, taxName: "KDV", taxAuthority: "Turkey Revenue Administration",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Turkish VAT applies from first sale. No threshold for foreign digital services."
  },
  MX: {
    countryCode: "MX", countryName: "Mexico",
    jurisdiction: "MX", obligation: "immediate",
    vatRate: 0.16, taxName: "IVA", taxAuthority: "Mexico SAT",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Mexican IVA applies from first sale. Register with SAT."
  },
  CL: {
    countryCode: "CL", countryName: "Chile",
    jurisdiction: "CL", obligation: "immediate",
    vatRate: 0.19, taxName: "IVA", taxAuthority: "Chile SII",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Chilean IVA applies from first sale. Register with SII."
  },
  CO: {
    countryCode: "CO", countryName: "Colombia",
    jurisdiction: "CO", obligation: "immediate",
    vatRate: 0.19, taxName: "IVA", taxAuthority: "Colombia DIAN",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Colombian IVA applies from first sale. Register with DIAN."
  },
  AR: {
    countryCode: "AR", countryName: "Argentina",
    jurisdiction: "AR", obligation: "immediate",
    vatRate: 0.21, taxName: "IVA", taxAuthority: "Argentina AFIP",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Argentine IVA applies from first sale. Normally withheld by payment processor."
  },
  IL: {
    countryCode: "IL", countryName: "Israel",
    jurisdiction: "IL", obligation: "immediate",
    vatRate: 0.17, taxName: "מע״מ", taxAuthority: "Israel ITA",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Israeli VAT applies from first sale. Register with Israel Tax Authority."
  },

  // ── US — no federal obligation ────────────────────────────────────────────
  US: {
    countryCode: "US", countryName: "United States",
    jurisdiction: "NONE", obligation: "none",
    vatRate: 0, taxName: "N/A", taxAuthority: "N/A",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "No federal VAT/GST for foreign digital service sellers. Individual state thresholds not applicable at this scale."
  },

  // ── EEA (non-EU) — follow EU-style rules ─────────────────────────────────
  IS: {
    countryCode: "IS", countryName: "Iceland",
    jurisdiction: "NO", obligation: "threshold",
    vatRate: 0.24, taxName: "VSK", taxAuthority: "Iceland RSK",
    thresholdAmount: 2000000, thresholdCurrency: "ISK",
    notes: "Icelandic VAT — similar to VOEC scheme. Threshold ISK 2,000,000."
  },
  LI: {
    countryCode: "LI", countryName: "Liechtenstein",
    jurisdiction: "CH", obligation: "threshold",
    vatRate: 0.081, taxName: "MWST", taxAuthority: "Liechtenstein Tax Authority",
    thresholdAmount: 100000, thresholdCurrency: "CHF",
    notes: "Liechtenstein follows Swiss VAT rules. Threshold CHF 100,000."
  },

  // ── Other notable markets — no current obligation ─────────────────────────
  SG: {
    countryCode: "SG", countryName: "Singapore",
    jurisdiction: "NONE", obligation: "none",
    vatRate: 0.09, taxName: "GST", taxAuthority: "IRAS",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Singapore GST — overseas vendor registration scheme. Threshold SGD $1M, not applicable at this scale."
  },
  MY: {
    countryCode: "MY", countryName: "Malaysia",
    jurisdiction: "NONE", obligation: "none",
    vatRate: 0.08, taxName: "SST", taxAuthority: "Royal Malaysian Customs",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Malaysian SST on digital services. Threshold MYR 500,000, monitor at scale."
  },
  IN: {
    countryCode: "IN", countryName: "India",
    jurisdiction: "NONE", obligation: "none",
    vatRate: 0.18, taxName: "GST", taxAuthority: "CBIC India",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "Indian GST on OIDAR services. Complex compliance, monitor at scale."
  },
  ZA: {
    countryCode: "ZA", countryName: "South Africa",
    jurisdiction: "NONE", obligation: "none",
    vatRate: 0.15, taxName: "VAT", taxAuthority: "SARS",
    thresholdAmount: null, thresholdCurrency: null,
    notes: "South African VAT on electronic services. Threshold ZAR 1M, monitor at scale."
  },
};

// ─── Helper functions ─────────────────────────────────────────────────────────

// Get the rule for a country code — falls back to a safe default
export function getCountryRule(countryCode: string): CountryRule {
  const code = (countryCode ?? "").toUpperCase().trim();
  return COUNTRY_RULES[code] ?? {
    countryCode: code,
    countryName: code,
    jurisdiction: "NONE",
    obligation: "none",
    vatRate: 0,
    taxName: "N/A",
    taxAuthority: "N/A",
    thresholdAmount: null,
    thresholdCurrency: null,
    notes: "No VAT obligation identified for this country.",
  };
}

// Check if a country is blocked
export function isBlockedCountry(countryCode: string): boolean {
  return BLOCKED_COUNTRIES.has((countryCode ?? "").toUpperCase().trim());
}

// Check if a country is in the EU (for OSS threshold grouping)
export function isEuCountry(countryCode: string): boolean {
  return EU_COUNTRY_CODES.has((countryCode ?? "").toUpperCase().trim());
}

// Get the EU VAT rate for a specific EU country
export function getEuVatRate(countryCode: string): number {
  return EU_VAT_RATES[(countryCode ?? "").toUpperCase().trim()] ?? 0;
}

// Compute the applicable VAT rate for a payment given current threshold status
// thresholdCrossed: map of jurisdiction -> boolean (has threshold been crossed)
export function getApplicableVatRate(
  countryCode: string,
  thresholdCrossed: Record<string, boolean>
): number {
  const rule = getCountryRule(countryCode);

  if (rule.obligation === "blocked" || rule.obligation === "none") return 0;

  if (rule.obligation === "immediate") return rule.vatRate;

  // Threshold-based — check if threshold has been crossed
  const jurisdiction = rule.jurisdiction as string;
  if (!thresholdCrossed[jurisdiction]) return 0;

  // EU OSS — use the country-specific rate
  if (rule.jurisdiction === "EU_OSS") {
    return getEuVatRate(countryCode);
  }

  return rule.vatRate;
}

// Extract VAT from a gross amount (VAT-inclusive)
// e.g. extractVat(100, 0.20) = { net: 83.33, vat: 16.67 }
export function extractVat(
  grossAmount: number,
  vatRate: number
): { net: number; vat: number } {
  if (!vatRate || vatRate <= 0) return { net: grossAmount, vat: 0 };
  const vat = grossAmount - grossAmount / (1 + vatRate);
  const net = grossAmount - vat;
  return {
    net: Math.round(net * 1e9) / 1e9,
    vat: Math.round(vat * 1e9) / 1e9,
  };
}

// Get jurisdiction key for a country (used for threshold lookups)
export function getJurisdiction(countryCode: string): string {
  return getCountryRule(countryCode).jurisdiction;
}

// Human-readable jurisdiction name
export function getJurisdictionName(jurisdiction: string): string {
  const names: Record<string, string> = {
    UK:     "United Kingdom (HMRC)",
    EU_OSS: "European Union (OSS)",
    AU:     "Australia (ATO)",
    CA:     "Canada (CRA)",
    NO:     "Norway (VOEC)",
    NZ:     "New Zealand (IRD)",
    CH:     "Switzerland (FTA)",
    JP:     "Japan (NTA)",
    KR:     "South Korea (NTS)",
    TW:     "Taiwan (MOF)",
    SA:     "Saudi Arabia (ZATCA)",
    AE:     "UAE (FTA)",
    TR:     "Turkey (Revenue Admin)",
    MX:     "Mexico (SAT)",
    CL:     "Chile (SII)",
    CO:     "Colombia (DIAN)",
    AR:     "Argentina (AFIP)",
    IL:     "Israel (ITA)",
    NONE:   "No Obligation",
    BLOCKED:"Blocked",
  };
  return names[jurisdiction] ?? jurisdiction;
}

// All jurisdictions that have thresholds (for progress tracking)
export const THRESHOLD_JURISDICTIONS = [
  "UK", "EU_OSS", "AU", "CA", "NO", "NZ", "CH",
] as const;

// All jurisdictions with immediate VAT
export const IMMEDIATE_JURISDICTIONS = [
  "JP", "KR", "TW", "SA", "AE", "TR", "MX", "CL", "CO", "AR", "IL",
] as const;

// Threshold details for each jurisdiction
export const JURISDICTION_THRESHOLDS: Record<string, {
  amount: number;
  currency: string;
  label: string;
  vatRate: number | "varies";
  taxAuthority: string;
}> = {
  UK:     { amount: 90000,   currency: "GBP", label: "£90,000",   vatRate: 0.20,     taxAuthority: "HMRC" },
  EU_OSS: { amount: 10000,   currency: "EUR", label: "€10,000",   vatRate: "varies", taxAuthority: "EU OSS via HMRC" },
  AU:     { amount: 75000,   currency: "AUD", label: "A$75,000",  vatRate: 0.10,     taxAuthority: "Australian ATO" },
  CA:     { amount: 30000,   currency: "CAD", label: "C$30,000",  vatRate: 0.05,     taxAuthority: "Canada CRA" },
  NO:     { amount: 50000,   currency: "NOK", label: "NOK 50,000",vatRate: 0.25,     taxAuthority: "Norway VOEC" },
  NZ:     { amount: 60000,   currency: "NZD", label: "NZ$60,000", vatRate: 0.15,     taxAuthority: "New Zealand IRD" },
  CH:     { amount: 100000,  currency: "CHF", label: "CHF 100,000",vatRate: 0.081,   taxAuthority: "Switzerland FTA" },
};
