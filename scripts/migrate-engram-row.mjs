#!/usr/bin/env node
// migrate-engram-row.mjs — retira la fila `memory-engram` de un patch Cordis.
//
// Invocado por install.sh (--with-engram) para auto-reparar instalaciones
// viejas donde la fila vivía en el patch de un perfil: desde que existe en la
// capa global ($DSH_HOME/cordis.patch.yml), repetirla en un perfil rompe el
// arranque ("duplicate loader entry id").
//
// Uso: node scripts/migrate-engram-row.mjs <patch.yml>
//
// Estrategia POR BLOQUES top-level (jamás heurística de "subir/bajar"):
//   - Un bloque arranca en una línea `- …` a columna 0; los comentarios
//     contiguos inmediatamente arriba son su banner.
//   - Las filas de un bloque `- insert:` son los ítems `- id: …` a nivel hijo;
//     las líneas más indentadas debajo son continuación de esa fila; los
//     comentarios/blancos intermedios quedan como banner de la fila siguiente.
//   - Bloque cuyos grupos son TODOS la fila objetivo → se retira entero.
//   - Bloque polifila → cirugía: solo los grupos objetivo; hermanas intactas.
//   - Contenido a nivel hijo que no es ítem `- …` → exit 3 SIN tocar nada:
//     el instalador restaura el backup y pide edición manual. Falla ruidosa
//     antes que pérdida silenciosa.
//
// Exit codes: 0 ok (o no-op), 2 uso incorrecto, 3 formato desconocido.
import { readFileSync, writeFileSync } from "node:fs";

const pathArg = process.argv[2];
if (!pathArg) {
  console.error("uso: migrate-engram-row.mjs <patch.yml>");
  process.exit(2);
}

// Espejo EXACTO del detector estricto de install.sh/dream-doctor.sh: la fila
// real, no menciones en comentarios. [ \t\r]*$ admite CRLF y trailing spaces.
const ROW = /^[ \t]*-[ \t]+id:[ \t]*memory-engram[ \t\r]*$/;
const BLOCK_START = /^-[ \t]/;
const isBlank = (l) => l === "";
const isComment = (l) => /^[ \t]*#/.test(l);
const indentOf = (l) => l.match(/^[ \t]*/)[0].length;

const src = readFileSync(pathArg, "utf8");
const lines = src.split("\n");
if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // newline final

const starts = [];
for (let i = 0; i < lines.length; i++) {
  if (BLOCK_START.test(lines[i])) starts.push(i);
}

/** @type {Set<number>} */
const del = new Set();
let fullBlocks = 0;
let surgicalRows = 0;
let sawForeign = false;

for (let k = 0; k < starts.length; k++) {
  const s = starts[k];
  const e = k + 1 < starts.length ? starts[k + 1] : lines.length;
  if (!lines.slice(s, e).some((l) => ROW.test(l))) continue;

  // Nivel hijo = menor indentación > 0 entre contenido del bloque.
  let child = Number.POSITIVE_INFINITY;
  for (let i = s + 1; i < e; i++) {
    if (isBlank(lines[i]) || isComment(lines[i])) continue;
    const n = indentOf(lines[i]);
    if (n > 0 && n < child) child = n;
  }
  if (!Number.isFinite(child)) continue; // sin hijas: ROW no podría estar aquí

  // Partición en grupos de fila. Comentarios/blancos quedan PENDIENTES y se
  // adhieren al grupo siguiente (su banner); los finales, al último grupo.
  /** @type {{pre: number[], start: number, end: number, isTarget: boolean}[]} */
  const groups = [];
  let pending = [];
  let foreign = false;  for (let i = s + 1; i < e; i++) {
    const l = lines[i];
    if (isBlank(l) || isComment(l)) {
      pending.push(i);
      continue;
    }
    const ind = indentOf(l);
    if (ind === child && /^-[ \t]/.test(l.slice(ind))) {
      groups.push({ pre: pending, start: i, end: i + 1, isTarget: ROW.test(l) });
      pending = [];
    } else if (ind > child && groups.length > 0) {
      groups[groups.length - 1].end = i + 1;
    } else {
      // Ítem ajeno a nivel hijo o indentación imposible: formato desconocido.
      foreign = true;
      break;
    }
  }
  if (foreign) {
    sawForeign = true;
    continue; // este bloque NO se toca (falla ruidosa, no pérdida)
  }
  if (pending.length > 0 && groups.length > 0) {
    groups[groups.length - 1].end = Math.max(groups[groups.length - 1].end, pending[pending.length - 1] + 1);
  }

  const targets = groups.filter((g) => g.isTarget);
  if (targets.length === 0) continue;
  if (targets.length === groups.length) {
    // Todos los grupos son la fila objetivo: fuera el bloque con su banner.
    let b = s;
    while (b - 1 >= 0 && isComment(lines[b - 1])) b--;
    for (let i = b; i < e; i++) del.add(i);
    fullBlocks++;
  } else {
    // Polifila: cirugía solo sobre los grupos objetivo (+ su banner propio).
    for (const g of targets) {
      for (const i of g.pre) del.add(i);
      for (let i = g.start; i < g.end; i++) del.add(i);
      surgicalRows++;
    }
  }
}

// Todo-o-nada por archivo: si algún bloque objetivo tenía estructura
// desconocida, no se escribe NADA y el instalador restaura su backup.
if (sawForeign) {
  console.error(`migrate-engram-row: estructura YAML no reconocida junto a la fila en ${pathArg}; archivo intacto, se requiere edición manual.`);
  process.exit(3);
}

if (del.size === 0) process.exit(0); // no-op: preservar el archivo byte a byte

let out = lines.filter((_, i) => !del.has(i));
// Colapsar carreras de blancos que pudieran quedar tras las remociones.
out = out.reduce((acc, l) => {
  if (l === "" && acc[acc.length - 1] === "") return acc;
  acc.push(l);
  return acc;
}, []);
while (out.length > 0 && out[0] === "") out.shift();
while (out.length > 0 && out[out.length - 1] === "") out.pop();
// Capa sin contenido real → documento canónico de capa vacía.
if (!out.some((l) => !isBlank(l) && !isComment(l))) {
  writeFileSync(pathArg, "[]\n");
} else {
  writeFileSync(pathArg, `${out.join("\n")}\n`);
}
console.log(`migrate-engram-row: ${fullBlocks} bloque(s) completo(s), ${surgicalRows} fila(s) quirúrgica(s)`);
