// Verifica que toda acción de GitHub Actions esté fijada a un SHA completo de commit (40 hex)
// y lleve la versión legible en un comentario: `uses: owner/repo@<sha> # vX.Y.Z`.
// Las acciones locales (`./...`) y las imágenes `docker://` con digest sha256 también se aceptan.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = '.github/workflows';
const USES = /^\s*-?\s*uses:\s*(\S+)(.*)$/;
const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const VERSION_COMMENT = /#\s*v\d+\.\d+\.\d+/;
const DOCKER_DIGEST = /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/;

let files = [];
try {
  files = (await readdir(DIR)).filter((file) => /\.ya?ml$/.test(file));
} catch {
  // Sin workflows no hay nada que verificar.
}

const problems = [];
let checked = 0;
for (const file of files) {
  const lines = (await readFile(join(DIR, file), 'utf8')).split('\n');
  lines.forEach((line, index) => {
    const match = USES.exec(line);
    if (!match) return;
    checked += 1;
    const [, ref, rest] = match;
    const where = `${DIR}/${file}:${index + 1}`;
    if (ref.startsWith('./') || DOCKER_DIGEST.test(ref)) return;
    if (!PINNED.test(ref)) problems.push(`${where}: "${ref}" no está fijada a un SHA completo`);
    else if (!VERSION_COMMENT.test(rest)) problems.push(`${where}: falta "# vX.Y.Z" junto al SHA`);
  });
}

if (problems.length > 0) {
  console.error('Acciones de CI sin fijar por SHA:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.warn(`Acciones de CI: ${checked} referencias fijadas por SHA con versión legible.`);
