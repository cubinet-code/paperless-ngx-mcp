export const CUSTOM_FIELD_VALUE_DESCRIPTION =
  "The value for the custom field. For monetary fields, use currency code prefix format (e.g., USD10.00, GBP123.45, EUR9.99) — NOT trailing symbol format (e.g., 10.00$). For documentlink fields, use a single document ID (e.g., 123) or an array of document IDs (e.g., [123, 456]).";

export const CUSTOM_FIELD_QUERY_DESCRIPTION =
  'Custom-field filter as a JSON expression passed as a string. A condition is [field, operator, value], where field is the custom field\'s name or ID. Combine conditions with ["AND", [cond, …]] or ["OR", [cond, …]], and negate with ["NOT", cond]. Valid operators depend on the field\'s data type (e.g. exact, in, isnull, exists, icontains, gt, gte, lt, lte, range); pick an invalid one and Paperless names the valid ones. Examples: \'["Amount", "gte", 100]\', \'["AND", [["Due", "lt", "2026-10-01"], ["Paid", "exact", false]]]\'.';
