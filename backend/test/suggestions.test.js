import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepos } from "../src/repositories/memoryRepos.js";
import { findFieldSuggestions, recordFieldSuggestions } from "../src/services/suggestionService.js";

test("suggestions are field-scoped, normalized and hidden until 20 uses", async () => {
  const repos = createMemoryRepos();

  const semantic = await findFieldSuggestions(repos, "Emballage", "BO");
  assert.equal(semantic[0].word, "BOCAL");
  assert.equal(semantic[0].uses, 0);

  for (let use = 0; use < 19; use++) {
    await recordFieldSuggestions(repos, {
      Emballage: "FOURREAU",
      Additifs: "MULTI ADDITIFS",
      "Dans le scope ?": "OUI",
      "Compte Total": "123",
    });
  }

  assert.deepEqual(await findFieldSuggestions(repos, "Emballage", "FO"), []);
  await recordFieldSuggestions(repos, { Emballage: "FOURREAU" });

  const suggestions = await findFieldSuggestions(repos, "Emballage", "FO");
  assert.equal(suggestions[0].word, "FOURREAU");
  assert.equal(suggestions[0].uses, 20);
  assert.deepEqual(await findFieldSuggestions(repos, "Company", "BO"), []);
});

test("confirmed packaging terms are suggested immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(
    await findFieldSuggestions(repos, "Emballage", "BOITE BONHOMME DE NEIGE METAL"),
    [{ field: "Emballage", word: "BOITE BONHOMME DE NEIGE METAL", uses: 0 }],
  );
  assert.deepEqual(await findFieldSuggestions(repos, "Emballage", "FOURREAU"), []);
});

test("official perfume phrases are suggested immediately", async () => {
  const repos = createMemoryRepos();
  const phrase = "CHOCOLAT BLANC/LAIT /NOIR";

  assert.deepEqual(await findFieldSuggestions(repos, "INFO PARFUM", phrase), [
    { field: "INFO PARFUM", word: phrase, uses: 0 },
  ]);
});

test("Major Brand dictionary suggests complete values immediately and deduplicates repeated entries", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "Major Brand", "BECKY'S"), [
    { field: "Major Brand", word: "BECKY'S", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "Major Brand", "COTE D'OR"), [
    { field: "Major Brand", word: "COTE D'OR", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "Major Brand", "SORINI"), [
    { field: "Major Brand", word: "SORINI", uses: 0 },
  ]);
});

test("Brand dictionary suggests complete product values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "BRAND", "BEAUMESNIL ESCARGOTS"), [
    { field: "BRAND", word: "BEAUMESNIL ESCARGOTS PRALINE", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "BRAND", "COTE D'OR BIO"), [
    { field: "BRAND", word: "COTE D'OR BIO", uses: 0 },
  ]);
  const ligatureSuggestions = await findFieldSuggestions(repos, "BRAND", "VENDOME ŒUFS");
  assert.ok(ligatureSuggestions.some(({ word }) => word === "VENDOME ŒUFS A CACHER"));
});

test("NEW NOM DE SPECIALITE dictionary suggests complete values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "NEW NOM DE SPECIALITE", "CHOC'N'STICK"), [
    { field: "NEW NOM DE SPECIALITE", word: "CHOC'N'STICK", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "NEW NOM DE SPECIALITE", "TRUFFES COEUR FONDANT"), [
    { field: "NEW NOM DE SPECIALITE", word: "TRUFFES COEUR FONDANT", uses: 0 },
  ]);
});

test("Type De Confiserie dictionary suggests its complete values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "Type De Confiserie", "CALENDRIER DE L'AVENT"), [
    { field: "Type De Confiserie", word: "CALENDRIER DE L'AVENT", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "Type De Confiserie", "CONFISERIE CHOCOLAT/MOULAGE"), [
    { field: "Type De Confiserie", word: "CONFISERIE CHOCOLAT/MOULAGE", uses: 0 },
  ]);
});

test("bonus dictionaries are immediately available on every bonus field", async () => {
  const repos = createMemoryRepos();

  for (const field of ["Bonus1", "Bonus2", "Bonus3", "Bonus4"]) {
    assert.deepEqual(await findFieldSuggestions(repos, field, "BUY 2 GET 1 FREE"), [
      { field, word: "BUY 2 GET 1 FREE", uses: 0 },
    ]);
  }
});

test("INFO FOURRAGE dictionary suggests complete filling values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "INFO FOURRAGE", "ACAI & MYRTILLE"), [
    { field: "INFO FOURRAGE", word: "ACAI & MYRTILLE", uses: 0 },
  ]);
  const slashValue = await findFieldSuggestions(repos, "INFO FOURRAGE", "AMANDE SAVEUR FIGUE");
  assert.ok(slashValue.some(({ word }) =>
    word === "AMANDE SAVEUR FIGUE & MIEL/CEREALES CROUSTILLANTES SAVEUR ORANGE CANNELLE/PECAN SAVEUR CANNEBERGE ERABLE"));
  assert.deepEqual(await findFieldSuggestions(repos, "INFO FOURRAGE", "CONFITURE"), [
    { field: "INFO FOURRAGE", word: "CONFITURE", uses: 0 },
  ]);
});

test("PRESENTATION dictionary suggests all requested values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "PRESENTATION", "SANS JOUET/SURPRISE & SANS RUBAN"), [
    { field: "PRESENTATION", word: "SANS JOUET/SURPRISE & SANS RUBAN", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "PRESENTATION", "AVEC JOUET & SURPRISE"), [
    { field: "PRESENTATION", word: "AVEC JOUET & SURPRISE", uses: 0 },
  ]);
});

test("INFO GARNITURE dictionary suggests complete values immediately", async () => {
  const repos = createMemoryRepos();

  assert.deepEqual(await findFieldSuggestions(repos, "INFO GARNITURE", "BONBON CHOCOLAT PRALINE"), [
    { field: "INFO GARNITURE", word: "BONBON CHOCOLAT PRALINE", uses: 0 },
  ]);
  assert.deepEqual(await findFieldSuggestions(repos, "INFO GARNITURE", "OEUF MINI/LAPIN MINI"), [
    { field: "INFO GARNITURE", word: "OEUF MINI/LAPIN MINI", uses: 0 },
  ]);
});

test("Libelle Produit dictionary suggests the requested chocolate figurines immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "ABEILLE AU CHOCOLAT AU LAIT",
    "CANARD PIRATE AU CHOCOLAT AU LAIT",
    "HYPPOPOTAME AU CHOCOLAT AU LAIT",
    "OEUF POULE AU CHOCOLAT AU LAIT",
    "T-REX AU CHOCOLAT AU LAIT",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Libelle Produit", word), [
      { field: "Libelle Produit", word, uses: 0 },
    ]);
  }
});

test("Info Forme Noel dictionary suggests the requested seasonal shapes immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "ANGE MINI",
    "BALLON/CHAUSSURE",
    "BOULE/CONE DE PIN",
    "MULTIFORMES/PERE NOEL",
    "PAIN D'EPICE",
    "SAINT NICOLAS",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Forme Noel", word), [
      { field: "Info Forme Noel", word, uses: 0 },
    ]);
  }
});

test("Info Forme Pâques dictionary suggests the requested seasonal shapes immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "ABEILLE",
    "BALLON DE BASKET",
    "DINAUSAURE/DINO",
    "LAPIN/LAPINE/LIEVRE",
    "BALLON DE FOOT & LAPIN",
    "LAPIN & POUSSETTE",
    "OEUF/POISSON",
    "VALEUR INDISPONIBLE",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Forme Pâques", word), [
      { field: "Info Forme Pâques", word, uses: 0 },
    ]);
  }
});

test("Info Forme Permanent dictionary suggests the requested shapes immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "BAGUETTE",
    "DOME RECTANGULAIRE",
    "MANETTE DE JEU",
    "MOULES DE BOUCHOT",
    "PIECE D'ECHECS",
    "SAC A MAIN",
    "VERNIS A ONGLE",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Forme Permanent", word), [
      { field: "Info Forme Permanent", word, uses: 0 },
    ]);
  }
});

test("Info Forme Halloween dictionary suggests the requested shapes immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "ARAIGNEE",
    "CERCUEIL",
    "FIGURINE MINI",
    "SAUVE SOURIS",
    "YEUX DE MONSTRE",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Forme Halloween", word), [
      { field: "Info Forme Halloween", word, uses: 0 },
    ]);
  }
});

test("Info Sante Nature dictionary suggests the requested values immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "ALLEGE EN MG",
    "SANS SUCRE",
    "TENEUR EN SEL REDUITE",
    "SANS GAZ PROPULSEUR",
    "STANDARD",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Sante Nature", word), [
      { field: "Info Sante Nature", word, uses: 0 },
    ]);
  }
});

test("Extras dictionary suggests the requested values immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "1 CUILLERE",
    "2 CANNES A PECHE & 6 CANARDS",
    "AUTOCOLLANTS & BONBONS GELIFIES",
    "PELUCHE MUSICALE",
    "TIRELIRE LICORNE",
    "VALEUR INDISPONIBLE",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Extras", word), [
      { field: "Extras", word, uses: 0 },
    ]);
  }
});

test("Ethnique Info dictionary suggests the requested values immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of ["HALAL", "CASHER", "AFRO", "SANS HUILE DE PALME"]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Ethnique Info", word), [
      { field: "Ethnique Info", word, uses: 0 },
    ]);
  }
});

test("Info Label dictionary suggests the requested certification labels immediately", async () => {
  const repos = createMemoryRepos();

  for (const word of [
    "1% FOR THE PLANET",
    "BLEU BLANC CŒUR",
    "ECOCERT CONTRÔLE",
    "GLOBALG.A.P",
    "ORIGINE France GARANTIE",
    "WORLD FAIR TRADE ORGANIZATION",
  ]) {
    assert.deepEqual(await findFieldSuggestions(repos, "Info Label", word), [
      { field: "Info Label", word, uses: 0 },
    ]);
  }
});

test("additif dictionary phrases are suggested immediately", async () => {
  const repos = createMemoryRepos();
  const phrase = "AMANDE CARAMELISEE/ ECORCE D'ORANGE CONFITE/RAISIN SEC";

  assert.deepEqual(await findFieldSuggestions(repos, "Additifs", phrase), [
    { field: "Additifs", word: phrase, uses: 0 },
  ]);
});

test("suggestions can start from recurrent historical treatment values", async () => {
  const repos = createMemoryRepos();
  for (let sourceRow = 2; sourceRow < 22; sourceRow++) {
    await repos.treatments.insert({
      sourceRow,
      currentData: [{ k: "Emballage", v: "FOURREAU" }],
    });
  }

  const suggestions = await findFieldSuggestions(repos, "Emballage", "FO");
  assert.equal(suggestions[0].word, "FOURREAU");
  assert.equal(suggestions[0].uses, 20);
});