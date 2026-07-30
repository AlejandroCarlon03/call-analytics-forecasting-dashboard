// TEMPORARY verification-only test against real files outside the repo.
// Not part of the permanent suite — deleted after use.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readXlsx } from './readXlsx';
import { buildFromCsv } from './buildFromCsv';

const XLSX_PATH =
  'C:/Users/AlexL/OneDrive - Diamond Kitchen and Bath, Inc/Desktop/LatestRetellAIData.xlsx';
const CSV_PATH =
  'C:/Users/AlexL/OneDrive - Diamond Kitchen and Bath, Inc/Desktop/LatestRetellAIDataCSV.csv';

function log(msg: string) {
  writeFileSync('verify_out.log', msg + '\n', { flag: 'a' });
}

describe('real-file verification (xlsx vs csv agreement)', () => {
  it('produces the same daily rows from both formats', async () => {
    const buf = readFileSync(XLSX_PATH);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const rows = await readXlsx(ab);
    const csvFromXlsx = rows.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
    const xlsxResult = buildFromCsv(csvFromXlsx, 'LatestRetellAIData.xlsx', ab.byteLength);

    const csvText = readFileSync(CSV_PATH, 'utf8');
    const csvResult = buildFromCsv(csvText, 'LatestRetellAIDataCSV.csv', csvText.length);

    if (!xlsxResult.ok) {
      log('XLSX FAILED: ' + JSON.stringify(xlsxResult.errors));
      throw new Error('xlsx path failed: ' + JSON.stringify(xlsxResult.errors));
    }
    if (!csvResult.ok) {
      log('CSV FAILED: ' + JSON.stringify(csvResult.errors));
      throw new Error('csv path failed: ' + JSON.stringify(csvResult.errors));
    }

    log(`xlsx rowsRead=${xlsxResult.preview.rowsRead} rowsKept=${xlsxResult.preview.rowsKept} dateMin=${xlsxResult.preview.dateMin} dateMax=${xlsxResult.preview.dateMax}`);
    log(`csv  rowsRead=${csvResult.preview.rowsRead} rowsKept=${csvResult.preview.rowsKept} dateMin=${csvResult.preview.dateMin} dateMax=${csvResult.preview.dateMax}`);
    log(`xlsx daily rows=${xlsxResult.payload.daily.length} activeDays=${xlsxResult.payload.ingestion.active_days}`);
    log(`csv  daily rows=${csvResult.payload.daily.length} activeDays=${csvResult.payload.ingestion.active_days}`);

    const xlsxHourlyTotal = xlsxResult.payload.hourly.reduce((s, c) => s + c.calls, 0);
    const csvHourlyTotal = csvResult.payload.hourly.reduce((s, c) => s + c.calls, 0);
    log(`xlsx hourly total=${xlsxHourlyTotal} csv hourly total=${csvHourlyTotal}`);

    const xlsxTotalCost = xlsxResult.payload.daily.reduce((s, d) => s + d.total_cost, 0);
    const csvTotalCost = csvResult.payload.daily.reduce((s, d) => s + d.total_cost, 0);
    log(`xlsx totalCost=${xlsxTotalCost.toFixed(2)} csv totalCost=${csvTotalCost.toFixed(2)}`);

    const firstDayXlsx = xlsxResult.payload.daily.find((d) => d.date === '2026-05-18');
    const firstDayCsv = csvResult.payload.daily.find((d) => d.date === '2026-05-18');
    log(`xlsx 2026-05-18: ${JSON.stringify(firstDayXlsx)}`);
    log(`csv  2026-05-18: ${JSON.stringify(firstDayCsv)}`);

    // Compare every daily row between the two.
    const mismatches: string[] = [];
    const byDate = new Map(csvResult.payload.daily.map((d) => [d.date, d]));
    for (const row of xlsxResult.payload.daily) {
      const ref = byDate.get(row.date);
      if (!ref) {
        mismatches.push(`${row.date}: missing from csv`);
        continue;
      }
      for (const key of ['call_volume', 'total_cost', 'avg_duration_sec', 'median_duration_sec', 'max_duration_sec'] as const) {
        const a = row[key];
        const b = ref[key];
        if (a === null || b === null) {
          if (a !== b) mismatches.push(`${row.date} ${key}: xlsx=${a} csv=${b}`);
        } else if (Math.abs((a as number) - (b as number)) > 0.02) {
          mismatches.push(`${row.date} ${key}: xlsx=${a} csv=${b}`);
        }
      }
    }
    log(`mismatches: ${mismatches.length}`);
    for (const m of mismatches.slice(0, 20)) log('  ' + m);

    expect(mismatches).toEqual([]);
  });
});
