// Lee el texto de un ticket español y saca comercio, fecha y total.
// Puro: no toca red ni disco, para poder probarlo con tickets reales.

const CADENAS = [
  'MERCADONA', 'LIDL', 'CARREFOUR', 'ALCAMPO', 'EROSKI', 'CONSUM', 'ALDI', 'DIA', 'AHORRAMAS',
  'HIPERCOR', 'EL CORTE INGLES', 'SUPERCOR', 'BM SUPERMERCADOS', 'GADIS', 'FROIZ', 'BONPREU',
  'CONDIS', 'CAPRABO', 'SPAR', 'COVIRAN', 'HIPERDINO', 'MAS Y MAS', 'LUPA', 'MASYMAS', 'SIMPLY',
  'REPSOL', 'CEPSA', 'MOEVE', 'GALP', 'SHELL', 'BP', 'PETRONOR', 'BALLENOIL', 'PLENOIL',
  'IKEA', 'LEROY MERLIN', 'DECATHLON', 'PRIMARK', 'ZARA', 'MEDIA MARKT', 'MEDIAMARKT', 'FNAC',
  'PRIMOR', 'DRUIDA', 'DRUNI', 'CLAREL', 'SEPHORA', 'TIGER', 'ACTION', 'NORMAL', 'KIABI',
  'MCDONALD', 'BURGER KING', 'TELEPIZZA', 'TELEPI', 'STARBUCKS', 'VIPS', 'GOIKO', '100 MONTADITOS',
  'FARMACIA', 'PARAFARMACIA',
];

// Palabras que marcan una línea de total de verdad, de más a menos fiable.
const TOTAL_FUERTE = /\b(TOTAL\s*(A\s*PAGAR|COMPRA|\(?€\)?|EUR(OS)?|IMPORTE|VENTA)|IMPORTE\s*TOTAL|A\s*PAGAR)\b/;
const TOTAL_DEBIL = /\b(TOTAL|IMPORTE|IMP\.?)\b/;
// Líneas con "total" que NO son el total del ticket.
const NO_ES_TOTAL = /\b(SUB\s*-?\s*TOTAL|BASE|IVA|I\.V\.A|CUOTA|CAMBIO|DEVOL|ENTREGAD|AHORR|DESCUENTO|DTO|PUNTOS|ART[IÍ]CULOS|ARTS?\b|UNIDADES|UDS|LITROS|PRECIO\s*\/|KG)\b/;
// Líneas de pago: su importe suele coincidir con el total.
const PAGO = /\b(TARJETA|VISA|MASTERCARD|MAESTRO|CONTACTLESS|BIZUM|PAGO|COBRADO|EFECTIVO|ENTREGADO|IMPORTE\s*COBRADO|CREDITO|DEBITO)\b/;

const IMPORTE_RE = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,5}[,.]\d{2})(?![\d])/g;

export function sinAcentos(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function importeACentimos(txt) {
  let t = txt.trim();
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Math.round(parseFloat(t) * 100);
  return Number.isFinite(n) ? n : null;
}

function importesDeLinea(linea) {
  return [...linea.matchAll(IMPORTE_RE)].map((m) => importeACentimos(m[1])).filter((c) => c !== null && c > 0);
}

export function extraerTotal(lineas) {
  const candidatos = []; // { cents, peso, origen }
  const pagos = new Set();

  lineas.forEach((l, i) => {
    const L = sinAcentos(l.toUpperCase());
    if (PAGO.test(L) && !/CAMBIO|DEVOL/.test(L)) {
      for (const c of importesDeLinea(l)) pagos.add(c);
      // a veces el importe va en la línea siguiente
      if (importesDeLinea(l).length === 0 && lineas[i + 1]) for (const c of importesDeLinea(lineas[i + 1])) pagos.add(c);
    }
    if (NO_ES_TOTAL.test(L)) return;
    const fuerte = TOTAL_FUERTE.test(L);
    if (!fuerte && !TOTAL_DEBIL.test(L)) return;
    let imps = importesDeLinea(l);
    if (imps.length === 0 && lineas[i + 1]) imps = importesDeLinea(lineas[i + 1]);
    // Una línea de total con varios importes suele ser una tabla de IVA: se queda el mayor, con poco peso.
    if (imps.length === 1) candidatos.push({ cents: imps[0], peso: fuerte ? 3 : 2, origen: 'total' });
    else if (imps.length > 1) candidatos.push({ cents: Math.max(...imps), peso: 1, origen: 'total-varios' });
  });

  for (const c of candidatos) if (pagos.has(c.cents)) c.peso += 3;

  if (candidatos.length) {
    candidatos.sort((a, b) => b.peso - a.peso || b.cents - a.cents);
    const mejor = candidatos[0];
    return { cents: mejor.cents, seguro: mejor.peso >= 3 };
  }
  if (pagos.size) return { cents: Math.max(...pagos), seguro: false };
  return { cents: null, seguro: false };
}

const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, GEN: 1, FEBR: 2, ABRI: 4, MAIG: 5, JUNY: 6, JUL: 7, AGOS: 8, DES: 12 };

export function extraerFecha(texto, hoy = new Date()) {
  const anioHoy = hoy.getFullYear();
  const manana = Date.UTC(anioHoy, hoy.getMonth(), hoy.getDate() + 1);
  const candidatas = [];
  for (const m of texto.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)) candidatas.push([+m[1], +m[2], +m[3]]);
  for (const m of sinAcentos(texto.toUpperCase()).matchAll(/\b(\d{1,2})[\s\-\/.]*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC|GEN|DES)[A-Z]*[\s\-\/.]*(\d{2,4})\b/g))
    candidatas.push([+m[1], MESES[m[2]], +m[3]]);
  for (let [d, mo, y] of candidatas) {
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000) continue;
    let segura = true;
    // Un ticket de hace años casi siempre es un dígito mal leído (2026 -> 2020): se asume este año y se avisa.
    if (y < anioHoy - 1 || y > anioHoy) { y = anioHoy; segura = false; }
    let f = new Date(Date.UTC(y, mo - 1, d));
    if (f.getUTCMonth() !== mo - 1) continue;
    if (f.getTime() > manana) {
      if (segura) continue;
      f = new Date(Date.UTC(y - 1, mo - 1, d));
    }
    return { iso: f.toISOString().slice(0, 10), segura };
  }
  const iso = new Date(Date.UTC(anioHoy, hoy.getMonth(), hoy.getDate())).toISOString().slice(0, 10);
  return { iso, segura: false };
}

function bonito(nombre) {
  return nombre.toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// Nombres de cadena que también son palabras corrientes en un ticket ("IVA TIPO NORMAL", "BUEN DIA", "TRANSACTION"):
// solo cuentan si una de las tres primeras líneas EMPIEZA por ellos, que es donde va el nombre de la tienda.
const AMBIGUAS = new Set(['DIA', 'NORMAL', 'ACTION', 'SIMPLY', 'TIGER', 'LUPA', 'SPAR', 'SHELL', 'BP', 'CONSUM', 'FARMACIA']);
const plano = (ls) => ' ' + sinAcentos(ls.join(' ').toUpperCase()).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';

export function extraerComercio(lineas) {
  const todo = plano(lineas);
  const primeras = lineas.slice(0, 3).map((l) => plano([l]));
  for (const c of CADENAS) {
    const esta = AMBIGUAS.has(c) ? primeras.some((l) => l.startsWith(' ' + c + ' ')) : todo.includes(' ' + c + ' ');
    if (esta) return { nombre: bonito(c), seguro: true };
  }
  for (const l of lineas.slice(0, 6)) {
    const L = sinAcentos(l.toUpperCase());
    if (/\b(CIF|NIF|C\.I\.F|TEL|TLF|CALLE|C\/|AVDA|AVENIDA|PLAZA|FACTURA|TICKET|FECHA|HORA)\b/.test(L)) continue;
    const letras = (l.match(/\p{L}/gu) || []).length;
    if (letras >= 4 && letras / l.replace(/\s/g, '').length > 0.6) {
      return { nombre: bonito(l.replace(/\b(S\.?\s?A\.?|S\.?\s?L\.?(U\.?)?)\s*$/i, '').trim()).slice(0, 40), seguro: false };
    }
  }
  return { nombre: null, seguro: false };
}

export function leerTicket(texto, hoy = new Date()) {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const total = extraerTotal(lineas);
  const fecha = extraerFecha(texto, hoy);
  const comercio = extraerComercio(lineas);
  return {
    comercio: comercio.nombre,
    fecha: fecha.iso,
    cents: total.cents,
    seguro: { comercio: comercio.seguro, fecha: fecha.segura, total: total.seguro },
  };
}

export function formatoEuros(cents) {
  return (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
