// Reads one sheet of an .xlsx workbook as rows of cell values (strings,
// numbers, booleans). Enough for generated workbooks; no dependencies.
import { readZip } from "./zip.mjs";

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function openWorkbook(buf) {
  const zip = readZip(buf);
  const text = (name) => zip.read(name)?.toString("utf8") ?? "";
  const rels = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])[1];
    const target = /Target="([^"]+)"/.exec(m[0])[1];
    return [id, target.startsWith("/") ? target.slice(1) : `xl/${target}`];
  }));
  const sheets = new Map([...text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    return [name, rels.get(rid)];
  }));
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  return {
    sheetNames: [...sheets.keys()],
    /** Rows as arrays of values; empty cells are "". */
    rows(sheet) {
      const path = sheets.get(sheet);
      if (!path) throw new Error(`sheet ${sheet} not found`);
      const out = [];
      for (const row of text(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1];
          const body = c[2] ?? "";
          const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
          const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          let value = "";
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "inlineStr") value = textOf(body);
          else if (type === "str" || type === "e") value = v === undefined ? "" : decode(v);
          else if (type === "b") value = v === "1";
          else if (v !== undefined) value = Number(v);
          cells[ref ? columnIndex(ref) : cells.length] = value;
        }
        out.push(Array.from(cells, (x) => x ?? ""));
      }
      return out;
    },
    /** Rows as objects keyed by the header row. */
    records(sheet) {
      const [header, ...rest] = this.rows(sheet);
      return rest.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(header.map((h, i) => [String(h), r[i] ?? ""])));
    },
  };
}
