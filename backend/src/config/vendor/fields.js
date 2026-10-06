// COPIE de chocolat-main/src/data/fields.js — garder synchronisée avec le frontend (voir README).
/**
 * Liste des 53 champs de saisie éditables par l'agent.
 * L'ordre détermine l'affichage dans le formulaire et le tri des erreurs (même index = même priorité de champ).
 * Ces noms correspondent exactement aux en-têtes de colonnes du Google Sheet source.
 */
export const SCOPE_FIELD = "Dans le scope ?";

export const FIELDS = [
  SCOPE_FIELD,
  "NOM",
  "CODIFICATION AVEC PHOTO oui/non",
  "EAN13", "Company", "Major Brand", "BRAND", "NEW NOM DE SPECIALITE", "Label", "Bonus1", "Bonus2", "Bonus3", "Bonus4",
  "Type De Produit", "Emballage", "INFO PARFUM", "Additifs", "INFO FOURRAGE",
  "Type De Confiserie", "TYPE DE SPECIALITE",
  "TYPE DE SUBSTITUT", "PRESENTATION", "INFO GARNITURE", "INFO DRAGEIFIE", "INFO CREUX/PLEIN", "INFO ATTACHE",
  "Libelle Produit", "Localisation", "Info Saison", "Info HALLOWEEN", "Info Noel", "Info Paques", "INFO AUTOMNE",
  "INFO SAINT VALENTIN", "INFO FETE DES MERES", "Info Forme Noel", "Info Forme Pâques", "Info Forme Permanent",
  "Info Forme Halloween", "INFO FORME AUTOMNE", "INFO FORME ST VALENTIN", "INFO FORME FETE DES MERES",
  "Info Sante Nature", "Extras", "Ethnique Info", "Informations Bilgcls", "Info Ecologique",
  "Info Commerce Equtbl", "Info Label", "Info Promotion", "Onces Totales", "Compte Total", "Compte Total De Paqt",
];

/**
 * 9 champs source en lecture seule (provenant du système client / Google Sheet).
 * Ne sont JAMAIS modifiés par l'agent ; affichés en lecture seule dans l'UI.
 * Chaque entrée : [nomTechnique, descriptionHumaine].
 */
export const READONLY = [
  ["NOM KC", "Code catégorie client"],
  ["KEYCAT", "Catégorie clé produit"],
  ["UPC", "Identifiant code article d'origine"],
  ["State", "État de la ligne dans le système client"],
  ["System", "Métadonnée système d'origine"],
  ["Generation", "Version du flux client"],
  ["Vendor", "Nom du fournisseur"],
  ["Item", "Référence article fournisseur"],
  ["CONCATENER", ""],
];

/**
 * Types de produits possibles (champ "Type De Produit").
 * Détermine les valeurs disponibles pour "TYPE DE SUBSTITUT".
 */
export const PRODUCT_TYPES = [
  "SUBSTITUT CHOCOLAT & SPECIALITE CHOCOLAT",
  "CHOCOLAT & SPECIALITE CHOCOLAT",
];

/**
 * Types de confiserie possibles (champ "Type De Confiserie").
 * Détermine les valeurs disponibles pour "TYPE DE SPECIALITE", "INFO GARNITURE", "INFO CREUX/PLEIN".
 */
export const CONFISERY_TYPES = ["SPECIALITE CHOCOLAT", "CONFISERIE CHOCOLAT", "MOULAGE"];

/**
 * Configuration des saisons et leurs champs de forme associés.
 * Chaque saison a : un champ de sélection (field), un nom (name), un champ de forme (shape),
 * et des valeurs possibles pour le champ de forme (shapes).
 * Logique : si "Info Saison" = "SAISONNIER", on choisit une saison spécifique,
 * puis on choisit sa forme. Si "PERMANENT", les champs de saison deviennent "NON APPLICABLE".
 */
export const SEASONS = [
  { field: "Info Noel", name: "NOEL", shape: "Info Forme Noel", shapes: ["VALEUR INDISPONIBLE", "MULTIFORMES"] },
  { field: "Info Paques", name: "PAQUES", shape: "Info Forme Pâques", shapes: ["VALEUR INDISPONIBLE", "MULTIFORMES"] },
  { field: "INFO AUTOMNE", name: "AUTOMNE", shape: "INFO FORME AUTOMNE", shapes: ["VALEUR INDISPONIBLE"] },
  { field: "Info HALLOWEEN", name: "HALLOWEEN", shape: "Info Forme Halloween", shapes: ["VALEUR INDISPONIBLE", "MULTIFORMES"] },
  { field: "INFO SAINT VALENTIN", name: "SAINT VALENTIN", shape: "INFO FORME ST VALENTIN", shapes: ["VALEUR INDISPONIBLE", "MULTIFORMES"] },
  { field: "INFO FETE DES MERES", name: "FETES DES MERES", shape: "INFO FORME FETE DES MERES", shapes: ["VALEUR INDISPONIBLE", "MULTIFORMES"] },
];

/**
 * Valeurs par défaut pré-remplies pour certains champs au chargement.
 * Ces valeurs sont fusionnées avec emptyValues() pour créer l'état initial du formulaire.
 */
export const DEFAULT_VALUES = {
  Label: "SANS LABEL",
  Bonus1: "RP",
  "INFO PARFUM": "CHOCOLAT",
  "TYPE DE SUBSTITUT": "CHOVIVA",
  Localisation: "ETAGERE",
  "Compte Total": "1",
};

/**
 * Valeur sentinelle pour indiquer "Autre (saisie libre)" dans les champs de type select.
 * Utilisée quand l'utilisateur veut saisir une valeur non listée.
 */
export const OTHER_OPTION = "__OTHER__";

/**
 * Options pour les champs de type select (biologique, écologique, équitable).
 * Ces champs n'ont que deux valeurs possibles.
 */
const BIOLOGICAL_OPTIONS = ["BIOLOGIQUE", "NON BIOLOGIQUE"];
const ECOLOGICAL_OPTIONS = ["ECOLOGIQUE", "NON ECOLOGIQUE"];
const FAIR_OPTIONS = ["EQUITABLE", "NON EQUITABLE"];

/**
 * Option placeholder affichée en premier dans les listes déroulantes.
 * value="" pour ne pas être une vraie valeur sélectionnable.
 */
const placeholder = { value: "", label: "Sélectionner..." };

/**
 * Option "Autres" pour les champs select avec saisie libre.
 * Quand sélectionnée, affiche un champ texte libre (SuggestionInput).
 */
const otherOption = { value: OTHER_OPTION, label: "AUTRES (à renseigner)" };

/**
 * Renvoie les options de sélection pour un champ donné, selon les valeurs déjà saisies (dépendances).
 * @param {string} name - Nom du champ
 * @param {Object} values - Valeurs actuelles du formulaire (pour les dépendances)
 * @returns {Array} Tableau d'objets {value, label, disabled?} pour le composant Select
 */
export function getFieldOptions(name, values = {}) {
  let choices = [];
  if (name === "Type De Produit") choices = PRODUCT_TYPES;
  else if (name === "Informations Bilgcls") choices = BIOLOGICAL_OPTIONS;
  else if (name === "Info Ecologique") choices = ECOLOGICAL_OPTIONS;
  else if (name === "Info Commerce Equtbl") choices = FAIR_OPTIONS;
  else if (name === "TYPE DE SPECIALITE") {
    // Dépend de "Type De Confiserie"
    const confiserieType = values["Type De Confiserie"] ?? "";
    choices = [
      ...(confiserieType.includes("SPECIALITE CHOCOLAT") ? ["ASSORTIMENT CHOCOLAT", "SPECIALITE CHOCOLAT"] : []),
      ...(confiserieType.includes("CONFISERIE CHOCOLAT") ? ["ASSORTIMENT CONFISERIE CHOCOLAT", "CONFISERIE CHOCOLAT"] : []),
      ...(confiserieType.includes("MOULAGE") ? ["ASSORTIMENT MOULAGE"] : []),
    ];
  } else if (name === "TYPE DE SUBSTITUT") {
    // Dépend de "Type De Produit"
    const notApplicable = values["Type De Produit"] === PRODUCT_TYPES[1]; // "CHOCOLAT & SPECIALITE CHOCOLAT"
    choices = [
      { value: "CHOVIVA", label: "CHOVIVA", disabled: notApplicable },
      { ...otherOption, disabled: notApplicable },
      { value: "NON APPLICABLE", label: "NON APPLICABLE", disabled: !notApplicable },
    ];
  } else if (name === "Additifs") {
    choices = ["MULTI ADDITIFS", "VALEUR INDISPONIBLE", "SANS ADDITIF", OTHER_OPTION];
  } else if (name === "INFO GARNITURE") {
    // Dépend de "Type De Confiserie"
    choices = (values["Type De Confiserie"] ?? "").includes("MOULAGE")
      ? ["NON GARNI", "VALEUR INDISPONIBLE", OTHER_OPTION]
      : ["NON APPLICABLE"];
  } else if (name === "INFO DRAGEIFIE") {
    choices = [
      "DRAGEIFIE", "NON DRAGEIFIE", "DRAGEIFIE/NON DRAGEIFIE",
      "NON APPLICABLE", "VALEUR INDISPONIBLE",
    ];
  } else if (name === "INFO CREUX/PLEIN") {
    // Dépend de "Type De Confiserie"
    choices = (values["Type De Confiserie"] ?? "").includes("MOULAGE")
      ? ["CREUX", "PLEINS", "CREUX/PLEINS"]
      : ["NON APPLICABLE"];
  } else if (name === "INFO ATTACHE") {
    choices = ["SANS ATTACHE", "AVEC ATTACHE", "VALEUR INDISPONIBLE"];
  } else if (name === "Info Saison") {
    choices = ["PERMANENT", "SAISONNIER", "PERMANENT/SAISONNIER"];
  } else if (name === "Info Forme Permanent") {
    // Dépend de "Info Saison"
    choices = values["Info Saison"] === "SAISONNIER"
      ? ["NON APPLICABLE"]
      : ["VALEUR INDISPONIBLE", "MULTIFORMES", OTHER_OPTION];
  } else {
    // Champs de saison dynamique (ex: "Info Noel", "Info Forme Noel", etc.)
    const season = SEASONS.find(({ field, shape }) => field === name || shape === name);
    if (season && season.field === name) choices = [`NON ${season.name}`, season.name];
    if (season && season.shape === name) {
      // Le champ de forme dépend du champ de saison correspondant
      choices = values[season.field] === `NON ${season.name}`
        ? ["NON APPLICABLE"]
        : [...season.shapes, OTHER_OPTION];
    }
  }

  // On préfixe toujours avec le placeholder, et on transforme les chaînes en objets {value, label}
  return [placeholder, ...choices.map((choice) =>
    choice === OTHER_OPTION ? otherOption : typeof choice === "string" ? { value: choice, label: choice } : choice,
  )];
}

/**
 * Détermine le type de contrôle UI à afficher pour un champ.
 * Types possibles : "yesno" (OUI/NON), "number", "select" (liste déroulante), "text" (par défaut).
 * @param {string} name - Nom du champ
 * @returns {string} Type de contrôle
 */
export function fieldType(name) {
  if (["CODIFICATION AVEC PHOTO oui/non", SCOPE_FIELD].includes(name)) return "yesno";
  if (["Onces Totales", "Compte Total", "Compte Total De Paqt"].includes(name)) return "number";
  if ([
    "Type De Produit", "TYPE DE SPECIALITE", "TYPE DE SUBSTITUT",
    "Informations Bilgcls", "Info Ecologique", "Info Commerce Equtbl",
    "Additifs", "INFO GARNITURE", "INFO DRAGEIFIE", "INFO CREUX/PLEIN", "INFO ATTACHE",
    "Info Saison", "Info Forme Permanent", ...SEASONS.map(({ field }) => field), ...SEASONS.map(({ shape }) => shape),
  ].includes(name)) return "select";
  return "text";
}

/**
 * Indique si un champ doit être affiché en largeur pleine (grande zone de texte).
 * @param {string} name - Nom du champ
 * @returns {boolean}
 */
export function isWide(name) {
  return ["INFO PARFUM", "Additifs", "INFO FOURRAGE"].includes(name);
}

/**
 * Convertit un nom de champ en identifiant HTML valide (pour les attributs id, aria-describedby, etc.).
 * Supprime les accents, met en minuscules, remplace les non-alphanumériques par des tirets.
 * @param {string} s - Chaîne à convertir
 * @returns {string} Identifiant CSS/HTML valide
 */
export const fieldId = (s) =>
  "f-" + s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Crée un objet avec tous les champs éditables initialisés à "" (vide),
 * fusionné avec DEFAULT_VALUES pour les pré-remplissages.
 * @returns {Object} Objet { champ: valeur }
 */
export const emptyValues = () => ({
  ...Object.fromEntries(FIELDS.map((k) => [k, ""])),
  ...DEFAULT_VALUES,
});