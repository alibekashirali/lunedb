import { describe, it, expect } from "vitest";
import {
  splitStatements,
  splitStatementsWithRanges,
  getStatementAtCursor,
} from "@/lib/sql-statements";

describe("splitStatements", () => {
  it("splits on semicolons and drops empty statements", () => {
    expect(splitStatements("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(splitStatements("SELECT 1;;  ;SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
    expect(splitStatements("   ")).toEqual([]);
  });

  it("keeps the last statement when it has no trailing semicolon", () => {
    expect(splitStatements("SELECT 1;\nSELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    expect(splitStatements("SELECT ';'; SELECT 2")).toEqual(["SELECT ';'", "SELECT 2"]);
  });

  it("handles doubled quotes as an escaped quote", () => {
    expect(splitStatements("SELECT 'it''s; fine'; SELECT 2")).toEqual([
      "SELECT 'it''s; fine'",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside quoted identifiers", () => {
    expect(splitStatements('SELECT "a;b" FROM t; SELECT 2')).toEqual([
      'SELECT "a;b" FROM t',
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside line and block comments", () => {
    expect(splitStatements("SELECT 1 -- one; two\n; SELECT 2")).toEqual([
      "SELECT 1 -- one; two",
      "SELECT 2",
    ]);
    expect(splitStatements("SELECT 1 /* a; b */; SELECT 2")).toEqual([
      "SELECT 1 /* a; b */",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside dollar-quoted bodies", () => {
    const fn = [
      "CREATE FUNCTION f() RETURNS int AS $$",
      "  BEGIN RETURN 1; END;",
      "$$ LANGUAGE plpgsql;",
      "SELECT f()",
    ].join("\n");
    const stmts = splitStatements(fn);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("RETURN 1;");
    expect(stmts[1]).toBe("SELECT f()");
  });

  it("honours tagged dollar quotes", () => {
    const sql = "SELECT $tag$ a; b $tag$; SELECT 2";
    expect(splitStatements(sql)).toEqual(["SELECT $tag$ a; b $tag$", "SELECT 2"]);
  });

  it("does not hang on an unterminated string or comment", () => {
    expect(splitStatements("SELECT 'unterminated")).toEqual(["SELECT 'unterminated"]);
    expect(splitStatements("SELECT 1 /* unterminated")).toEqual(["SELECT 1 /* unterminated"]);
  });
});

describe("splitStatementsWithRanges", () => {
  it("reports offsets that point at the statement in the original text", () => {
    const sql = "  SELECT 1;\nSELECT 2";
    const [first, second] = splitStatementsWithRanges(sql);
    expect(sql.slice(first.from, first.to)).toBe("SELECT 1;");
    expect(sql.slice(second.from, second.to)).toBe("SELECT 2");
  });
});

describe("getStatementAtCursor", () => {
  const sql = "SELECT 1;\nSELECT 2;\nSELECT 3";

  it("returns the statement the cursor sits in", () => {
    expect(getStatementAtCursor(sql, 3)).toBe("SELECT 1");
    expect(getStatementAtCursor(sql, sql.indexOf("SELECT 2") + 2)).toBe("SELECT 2");
    expect(getStatementAtCursor(sql, sql.length)).toBe("SELECT 3");
  });

  it("treats the gap after a semicolon as still belonging to that statement", () => {
    // Cursor right after "SELECT 1;" but before "SELECT 2".
    expect(getStatementAtCursor(sql, 9)).toBe("SELECT 1");
  });

  it("falls back to the whole text when nothing parses", () => {
    expect(getStatementAtCursor("   ", 1)).toBe("");
  });

  it("returns the only statement regardless of cursor position", () => {
    expect(getStatementAtCursor("SELECT 1", 0)).toBe("SELECT 1");
  });
});
