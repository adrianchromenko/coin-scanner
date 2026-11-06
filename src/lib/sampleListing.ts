import type { CoinListing } from "./coinSchema";

/** Used by `?demo=1` to preview the listing screen without an API key. */
export const SAMPLE_LISTING: CoinListing = {
  identified: true,
  confidence: 0.86,
  title: "1921-S Morgan Silver Dollar – Circulated VF – 90% Silver – San Francisco Mint",
  country: "United States",
  denomination: "Dollar",
  year: "1921",
  mint_mark: "S",
  coin_type: "Morgan Dollar",
  variety: "None noted",
  composition: "90% silver, 10% copper",
  diameter_mm: 38.1,
  weight_g: 26.73,
  precious_metal_content: "0.7734 oz ASW",
  era: "Early 20th century",
  circulated: true,
  grade_estimate: "VF-25",
  grade_reasoning:
    "Even, moderate wear across Liberty's hair above the ear and the eagle's breast feathers. Rims are full, devices remain clear, and the fields show light contact marks consistent with circulation.",
  problems: [],
  certification: "Raw / uncertified",
  km_number: "KM# 110",
  description:
    "1921-S Morgan Silver Dollar struck at the San Francisco Mint in the final year of the series.\n\nCondition: Circulated, estimated Very Fine (VF-25). Honest, even wear with no cleaning, damage, or rim problems noted. Attractive light grey toning.\n\nSpecifications: 90% silver, 26.73 g, 38.1 mm. Approximately 0.77 troy oz of pure silver.\n\nPhotos show the exact coin you will receive. Ships securely in a protective flip.",
  item_specifics: [
    { name: "Country/Region of Manufacture", value: "United States" },
    { name: "Denomination", value: "$1" },
    { name: "Year", value: "1921" },
    { name: "Mint Location", value: "San Francisco" },
    { name: "Composition", value: "Silver" },
    { name: "Fineness", value: "0.9" },
    { name: "Circulated/Uncirculated", value: "Circulated" },
    { name: "Grade", value: "VF 25" },
    { name: "Certification", value: "Uncertified" },
    { name: "Coin", value: "Morgan" },
  ],
  estimated_value_usd: { low: 32, high: 45 },
  suggested_price_usd: 39,
  identification_notes:
    "Obverse shows the Morgan Liberty head with date 1921; reverse shows the S mint mark below the wreath bow. The 1921 issue uses the modified shallow-relief hubs, visible in the flatter hair detail.",
};
