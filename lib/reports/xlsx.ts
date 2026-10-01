import "server-only";

import ExcelJS from "exceljs";
import { formatIst } from "@/lib/db/repositories/owner-reports";

type SheetData = { name: string; headers: string[]; rows: Array<Array<string | number | null>> };

function sheet(workbook: ExcelJS.Workbook, data: SheetData) {
  const worksheet = workbook.addWorksheet(data.name);
  worksheet.addRow(data.headers);
  for (const row of data.rows) worksheet.addRow(row);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.headers.length } };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF49366D" } };
  worksheet.columns.forEach((column) => { column.width = 18; });
  data.headers.forEach((header, index) => { worksheet.getColumn(index + 1).width = Math.min(42, Math.max(16, header.length + 2)); });
  return worksheet;
}
export async function workbookBuffer(title: string, sheets: SheetData[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nazraa Control";
  workbook.created = new Date();
  workbook.subject = "Read-only authorized report";
  workbook.title = title;
  for (const data of sheets) sheet(workbook, data);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function summarySheet(rows: Array<[string, string | number]>) {
  return { name: "Summary", headers: ["Metric", "Value"], rows };
}

export function exportRowDate(value: string | Date | null | undefined) {
  return formatIst(value);
}
