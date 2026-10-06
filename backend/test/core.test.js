import test from "node:test";
import assert from "node:assert/strict";
import { ALL_FIELDS, EDITABLE_FIELDS, SOURCE_FIELDS } from "../src/config/fields.js";
import { fieldType, getFieldOptions, SCOPE_FIELD } from "../src/config/vendor/fields.js";
import { getRules } from "../src/config/vendor/rules.js";
import { canTransition, TREATMENT_STATUS as S } from "../src/constants/index.js";
import { diffValues } from "../src/diff/diffEngine.js";
import { RULES, runRules } from "../src/rules/index.js";
import { formatValue } from "../src/utils/normalize.js";
import { validValues } from "./fixtures.js";

test("62 champs = 53 saisie + 9 source, sans doublon", () => {
  assert.equal(EDITABLE_FIELDS.length, 53);
  assert.equal(SOURCE_FIELDS.length, 9);
  assert.equal(new Set(ALL_FIELDS).size, 62);
});

test("configuration des champs : scope et options select", () => {
  assert.equal(fieldType(SCOPE_FIELD), "yesno");
  assert.equal(fieldType("Type De Confiserie"), "text");
  assert.equal(getRules("Type De Confiserie").oneOf, undefined);
  assert.equal(getRules("Onces Totales").unitSuffix, true);
  assert.deepEqual(
    getFieldOptions("INFO DRAGEIFIE").map(({ value }) => value).filter(Boolean),
    ["DRAGEIFIE", "NON DRAGEIFIE", "DRAGEIFIE/NON DRAGEIFIE", "NON APPLICABLE", "VALEUR INDISPONIBLE"],
  );
  assert.deepEqual(
    getFieldOptions("TYPE DE SPECIALITE", { "Type De Confiserie": "MOULAGE" })
      .map(({ value }) => value)
      .filter(Boolean),
    ["ASSORTIMENT MOULAGE"],
  );
  assert.deepEqual(
    getFieldOptions("TYPE DE SPECIALITE", { "Type De Confiserie": "CONFISERIE CHOCOLAT/MOULAGE" })
      .map(({ value }) => value)
      .filter(Boolean),
    ["ASSORTIMENT CONFISERIE CHOCOLAT", "CONFISERIE CHOCOLAT", "ASSORTIMENT MOULAGE"],
  );
  assert.deepEqual(
    getFieldOptions("INFO CREUX/PLEIN", { "Type De Confiserie": "CONFISERIE CHOCOLAT/MOULAGE" })
      .map(({ value }) => value)
      .filter(Boolean),
    ["CREUX", "PLEINS", "CREUX/PLEINS"],
  );
  assert.deepEqual(getRules("TYPE DE SPECIALITE", { "Type De Confiserie": "MOULAGE" }).oneOf, ["ASSORTIMENT MOULAGE"]);
});

test("règles backend : les valeurs autorisées dépendent des champs parents", () => {
  const rules = RULES.filter(({ field }) => field === "TYPE DE SPECIALITE");
  assert.deepEqual(runRules({ "Type De Confiserie": "MOULAGE", "TYPE DE SPECIALITE": "ASSORTIMENT MOULAGE" }, rules), []);
  assert.equal(runRules({ "Type De Confiserie": "MOULAGE", "TYPE DE SPECIALITE": "INVALIDE" }, rules).length, 1);
});

test("workflow : transitions", () => {
  assert.ok(canTransition(S.SUBMITTED, S.IN_QC));
  assert.ok(canTransition(S.IN_QC, S.CORRECTION_REQUIRED));
  assert.ok(canTransition(S.CORRECTION_REQUIRED, S.RESUBMITTED));
  assert.ok(!canTransition(S.APPROVED, S.IN_QC));
  assert.ok(!canTransition(S.DRAFT, S.APPROVED));
});

test("diff : uniquement les champs modifiés", () => {
  assert.deepEqual(diffValues({ a: "A", b: "B", c: "C" }, { a: "A", b: "X", c: "C" }), [
    { field: "b", oldValue: "B", newValue: "X" },
  ]);
  assert.deepEqual(diffValues({ a: "A" }, { a: "A", d: "" }), []);
  assert.equal(diffValues({}, { a: "1" }).length, 1);
});

test("règles : jeu valide → aucune erreur", () => assert.deepEqual(runRules(validValues()), []));

test("règles : Onces Totales accepte un montant avec unité optionnelle et applique le minimum", () => {
  for (const value of ["3", "3 GR", "3 OZ", "3 FL OZ", "3,5 GR"]) {
    assert.deepEqual(runRules(validValues({ "Onces Totales": value })), []);
  }
  assert.ok(runRules(validValues({ "Onces Totales": "abc" }))
    .some((error) => error.field === "Onces Totales" && error.errorType === "INVALID_FORMAT"));
  assert.ok(runRules(validValues({ "Onces Totales": "-1 GR" }))
    .some((error) => error.field === "Onces Totales" && error.message === "Minimum : 0"));
});

test("règles : NOM vide = CRITICAL, trié en premier", () => {
  const v = validValues({ NOM: "" });
  v["Compte Total"] = "1,5";
  v["Onces Totales"] = "abc";
  const errs = runRules(v);
  assert.equal(errs[0].field, "NOM");
  assert.equal(errs[0].priority, "CRITICAL");
  assert.equal(errs[0].errorType, "REQUIRED_FIELD");
  assert.ok(errs.some((e) => e.field === "Compte Total" && e.errorType === "INVALID_VALUE"));
  assert.ok(errs.some((e) => e.field === "Onces Totales" && e.errorType === "INVALID_FORMAT"));
  const ranks = errs.map((e) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(e.priority));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("règles : oneOf et longueur", () => {
  const v = validValues({ "CODIFICATION AVEC PHOTO oui/non": "PEUT-ETRE", NOM: "X".repeat(256) });
  const errs = runRules(v);
  assert.ok(errs.some((e) => e.field === "CODIFICATION AVEC PHOTO oui/non" && e.errorType === "INVALID_VALUE"));
  assert.ok(errs.some((e) => e.field === "NOM" && e.errorType === "INVALID_FORMAT"));
});

test("normalisation : majuscules sans accents", () => assert.equal(formatValue("Crème brûlée œuf"), "CREME BRULEE OEUF"));
