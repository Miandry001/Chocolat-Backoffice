import { EDITABLE_FIELDS } from "../src/config/fields.js";
import { fieldType, getFieldOptions, OTHER_OPTION, PRODUCT_TYPES } from "../src/config/vendor/fields.js";

export function validValues(overrides = {}) {
  const values = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, "X"]));
  Object.assign(values, {
    "Dans le scope ?": "OUI",
    NOM: "PRODUIT TEST",
    "CODIFICATION AVEC PHOTO oui/non": "OUI",
    "Type De Produit": PRODUCT_TYPES[0],
    "Type De Confiserie": "MOULAGE",
    "Info Saison": "PERMANENT",
    "Onces Totales": "3",
    "Compte Total": "3",
    "Compte Total De Paqt": "3",
  });

  for (const field of EDITABLE_FIELDS) {
    if (fieldType(field) === "yesno") values[field] = "OUI";
    if (fieldType(field) === "select") {
      const option = getFieldOptions(field, values)
        .find(({ value, disabled }) => value && value !== OTHER_OPTION && !disabled);
      values[field] = option?.value ?? "";
    }
  }

  return { ...values, ...overrides };
}
