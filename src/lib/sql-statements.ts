/**
 * Splitting a SQL script into statements, aware of the places where a `;`
 * is not a separator: strings, quoted identifiers, comments and dollar-quoted
 * bodies.
 */

export interface StmtRange {
  text: string; // trimmed SQL without trailing ;
  from: number; // start of non-whitespace content in original string
  to: number;   // position just after ; (or end of string for last stmt)
}

export function splitStatementsWithRanges(sql: string): StmtRange[] {
  const results: StmtRange[] = [];
  let i = 0;
  let contentStart = -1;

  const advance = (): void => {
    // skip inside single-quoted string
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; return; }
        i++;
      }
      return;
    }
    // skip inside double-quoted identifier
    if (sql[i] === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i++; return; }
        i++;
      }
      return;
    }
    // skip line comment
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      return;
    }
    // skip block comment
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      return;
    }
    // skip dollar-quoted string
    if (sql[i] === "$") {
      const m = sql.slice(i).match(/^\$([A-Za-z_0-9]*)\$/);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        return;
      }
    }
    i++;
  };

  while (i < sql.length) {
    // Track where the non-whitespace content starts
    if (contentStart === -1 && !/\s/.test(sql[i])) contentStart = i;

    if (sql[i] === ";") {
      const text = sql.slice(contentStart === -1 ? i : contentStart, i).trim();
      if (text) results.push({ text, from: contentStart === -1 ? i : contentStart, to: i + 1 });
      contentStart = -1;
      i++;
      continue;
    }

    advance();
  }

  // Final statement (no trailing semicolon)
  if (contentStart !== -1) {
    const text = sql.slice(contentStart).trim();
    if (text) results.push({ text, from: contentStart, to: sql.length });
  }

  return results;
}

export function splitStatements(sql: string): string[] {
  return splitStatementsWithRanges(sql).map((s) => s.text);
}

export function getStatementAtCursor(sql: string, cursor: number): string {
  const stmts = splitStatementsWithRanges(sql);
  if (!stmts.length) return sql.trim();
  if (stmts.length === 1) return stmts[0].text;

  // Each statement "owns" up to the start of the next one
  for (let idx = 0; idx < stmts.length; idx++) {
    const next = stmts[idx + 1];
    const ownedEnd = next ? next.from : sql.length;
    if (cursor >= stmts[idx].from && cursor <= ownedEnd) return stmts[idx].text;
  }
  // Cursor before first statement
  if (cursor < stmts[0].from) return stmts[0].text;
  return stmts[stmts.length - 1].text;
}
