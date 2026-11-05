// Sampling settings for every LLM call that reads or classifies data.
//
// These calls extract amounts, dates and names from receipts, invoices and
// contracts. With the provider's default temperature the same document could
// come back with different digits on different runs (e.g. 6,040 one time and
// 96,040 the next), so pin the temperature low for repeatable output.
// Vision gets a hair above zero because fully greedy decoding can loop on
// some Qwen models; it is still effectively deterministic.
export const TEXT_TEMPERATURE = 0;
export const VISION_TEMPERATURE = 0.1;
