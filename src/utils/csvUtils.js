// Neutralize spreadsheet formula injection: a leading =, +, -, @, TAB, or CR
// makes Excel/Sheets/LibreOffice treat the cell as a formula. Prefix with a
// single quote so it renders as literal text. Applied BEFORE quote-wrapping —
// quoting alone does not stop formula evaluation.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const neutralizeFormula = (s) => (FORMULA_LEAD.test(s) ? `'${s}` : s);

export const toCSVRow = (cells) =>
  cells
    .map((c) => {
      const s = neutralizeFormula(String(c ?? ''));
      return s.includes(',') ||
        s.includes('"') ||
        s.includes('\n') ||
        s.includes('\r')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
