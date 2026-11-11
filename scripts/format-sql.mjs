import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "sql-formatter";

const check = process.argv.includes("--check");
const root = fileURLToPath(new URL("../", import.meta.url));

async function formatDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await formatDirectory(filename);
      continue;
    }

    if (!entry.name.endsWith(".sql")) continue;

    const original = await readFile(filename, "utf8");
    const formatted = `${format(original, {
      language: "sqlite",
      keywordCase: "upper",
      tabWidth: 2,
    }).trimEnd()}\n`;
    const relative = path.relative(root, filename);

    if (formatted === original) continue;

    if (check) {
      console.error(`SQL formatting required: ${relative}`);
      process.exitCode = 1;
    } else {
      await writeFile(filename, formatted);
      console.log(`Formatted ${relative}`);
    }
  }
}

await formatDirectory(path.join(root, "db"));
