// Lee fotos de tickets con el lector local y enseña lo que saca. Uso: node scripts/leer.js foto1.jpg foto2.jpg
import fs from 'node:fs';
import { leerFoto } from '../ocr.js';
import { formatoEuros } from '../parser.js';
for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const r = await leerFoto(fs.readFileSync(f));
  console.log([f.split('/').pop(), r.comercio, r.fecha, r.cents ? formatoEuros(r.cents) : '-', JSON.stringify(r.seguro), `psm${r.psm}`, `${((Date.now() - t0) / 1000).toFixed(1)}s`].join('\t'));
  if (process.env.VERBOSE) console.log(r.texto);
}
