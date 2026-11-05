import fs from "node:fs";
import path from "node:path";

// Every LLM call that reads data must pin its temperature (see
// src/lib/services/ai/sampling.ts). Without it the provider default applies and
// the same receipt can be read differently on each run.

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("LLM calls pin their temperature", () => {
  const root = path.join(__dirname, "..");
  const calls: { file: string; line: number; block: string }[] = [];

  for (const file of sourceFiles(root)) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      if (/chat\.completions\.create\(/.test(text)) {
        // The options object is a handful of lines; stop at the first "});".
        const end = lines.findIndex((l, j) => j > i && /^\s*\}\);?\s*$/.test(l));
        calls.push({ file: path.relative(root, file), line: i + 1, block: lines.slice(i, end === -1 ? i + 15 : end + 1).join("\n") });
      }
    });
  }

  it("finds the LLM calls it is guarding", () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it.each(calls.map((c) => [`${c.file}:${c.line}`, c.block]))("%s sets temperature", (_where, block) => {
    expect(block).toMatch(/temperature:/);
  });
});
