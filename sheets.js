// Conexión con una hoja de Google Sheets, a través del Apps Script que va pegado dentro de la hoja
// (google-sheets/Codigo.gs). Hace lo mismo que actual.js, con los mismos nombres, para que el bot no note la diferencia.
// A Google solo le llega la fila ya leída (fecha, comercio, importe, categoría y nota), nunca la foto.
import { createHash } from 'node:crypto';

const url = process.env.SHEETS_URL;
const secreto = process.env.SHEETS_SECRET;

export const nombre = 'Google Sheets';

// Los botones de categoría llevan un id con forma de UUID; en la hoja las categorías son solo nombres,
// así que el id sale del nombre (siempre el mismo para el mismo nombre).
function idDe(nombreCat) {
  const h = createHash('md5').update(nombreCat).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function llamar(accion, datos = {}) {
  // Apps Script contesta con una redirección a googleusercontent.com: fetch la sigue sola y el script se ejecuta una vez.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secreto, accion, ...datos }),
    redirect: 'follow',
  });
  const texto = await res.text();
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error(`Google Sheets no ha contestado bien (HTTP ${res.status}). ¿Está bien SHEETS_URL?`); }
  if (!j.ok) throw new Error(j.error === 'secreto' ? 'El SHEETS_SECRET no coincide con el de la hoja' : `Google Sheets: ${j.error}`);
  return j;
}

export async function conectar() {
  if (!url) throw new Error('Falta la variable SHEETS_URL');
  if (!secreto) throw new Error('Falta la variable SHEETS_SECRET');
  await llamar('ping');
}

let cache = null;
let cacheHasta = 0;
export async function categorias() {
  if (cache && Date.now() < cacheHasta) return cache;
  const j = await llamar('categorias');
  cache = j.categorias.map((n) => ({ id: idDe(n), nombre: n }));
  cacheHasta = Date.now() + 60 * 1000; // si cambias las categorías en la hoja, el bot las ve en un minuto
  return cache;
}

// La categoría que usaste la última vez con ese comercio, si existe.
export async function categoriaSugerida(comercio) {
  if (!comercio) return null;
  const j = await llamar('sugerida', { comercio });
  return j.categoria ? idDe(j.categoria) : null;
}

export async function apuntar({ fecha, cents, comercio, categoria, nota }) {
  const nombreCat = categoria ? (await categorias()).find((c) => c.id === categoria)?.nombre || '' : '';
  const j = await llamar('apuntar', { fecha, importe: Math.abs(cents) / 100, comercio: comercio || 'Ticket', categoria: nombreCat, nota: nota || '' });
  return { totalMesCents: Math.round(j.totalMes * 100) };
}

export async function cerrar() {}
