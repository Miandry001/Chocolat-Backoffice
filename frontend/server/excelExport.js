import ExcelJS from "exceljs";
import {
  buildSubmittedValueUpdates,
  getUnselectedRowRanges,
  isCompleteTreatmentSelection,
  sheetNameFromRange,
} from "./sheetExport.js";

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function columnNumber(columnName) {
  return [...columnName].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function worksheetTitle(sourceRange) {
  return sheetNameFromRange(sourceRange).slice(1, -1).replace(/''/g, "'");
}

export async function buildFilledExcelWorkbook(sourceWorkbook, sourceRows, treatments, sourceRange, allTreatments = treatments) {
  const updates = buildSubmittedValueUpdates(sourceRows, treatments, sourceRange);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceWorkbook);

  const worksheet = workbook.getWorksheet(worksheetTitle(sourceRange));
  if (!worksheet) throw new Error(`L’onglet « ${worksheetTitle(sourceRange)} » est absent du classeur Excel.`);

  for (const update of updates) {
    const match = update.range.match(/!([A-Z]+)(\d+)$/);
    if (!match) throw new Error(`Plage de cellule invalide pour l’export : ${update.range}.`);
    worksheet.getCell(Number(match[2]), columnNumber(match[1])).value = update.values[0][0];
  }

  if (!isCompleteTreatmentSelection(treatments, allTreatments)) {
    for (const { startRow, count } of getUnselectedRowRanges(sourceRows, treatments)) {
      worksheet.spliceRows(startRow, count);
    }
    for (const otherSheet of [...workbook.worksheets]) {
      if (otherSheet.id !== worksheet.id) workbook.removeWorksheet(otherSheet.id);
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export { EXCEL_MIME_TYPE };
