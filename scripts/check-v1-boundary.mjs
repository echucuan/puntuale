// Verifica la frontera V1/V2 (ADR 0006): el código ejecutable de la V1 no maneja dinero.
// Revisa solo código y migraciones (.ts, .tsx, .js, .sql) de apps/, packages/ y db/.
// La documentación (Markdown) sí puede mencionar la V2 y la nómina, así que no se revisa.
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const ROOTS = ['apps', 'packages', 'db'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const FORBIDDEN =
  /\b(payroll|payslip|salar(y|io|ios|ies)|wages?|sueldos?|n[oó]minas?|percepci[oó]n(es)?|deducci[oó]n(es)?|finiquito|aguinaldo)\b/i;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const findings = [];
for (const root of ROOTS) {
  for await (const file of walk(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      const match = FORBIDDEN.exec(line);
      if (match) findings.push(`${relative('.', file)}:${index + 1}: "${match[0]}"`);
    });
  }
}

if (findings.length > 0) {
  console.error('La V1 no maneja dinero (ADR 0006). Términos de nómina en código ejecutable:');
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.warn('Frontera V1/V2: sin términos de nómina en el código ejecutable.');
