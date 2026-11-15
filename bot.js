// Bot de Telegram: mandas la foto del ticket, te enseña lo que ha leído y, si le das a Guardar, lo apunta en Actual
// o en Google Sheets (DESTINO=sheets).
import { randomUUID } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import { leerFoto } from './ocr.js';
import { formatoEuros, importeACentimos } from './parser.js';
// Dónde se apuntan los gastos: Actual (por defecto) o Google Sheets. Los dos módulos tienen las mismas funciones.
const actual = process.env.DESTINO === 'sheets' ? await import('./sheets.js') : await import('./actual.js');

const token = process.env.TELEGRAM_TOKEN;
const permitidos = new Set((process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
if (!token) throw new Error('Falta TELEGRAM_TOKEN');

const bot = new Bot(token);
const pendientes = new Map(); // id → { fecha, cents, comercio, categoria, nombreCat, creado }
const esperando = new Map(); // chatId → { id, campo, hasta }
const ESPERA_MS = 10 * 60 * 1000; // una pregunta del bot caduca a los 10 minutos
const PENDIENTE_MS = 7 * 24 * 60 * 60 * 1000; // una tarjeta sin guardar caduca a la semana

// Id único por tarjeta: si el bot se reinicia, una tarjeta vieja nunca apunta a un ticket nuevo.
const nuevoId = () => randomUUID().replace(/-/g, '').slice(0, 10);
const ID = '([0-9a-f]{10})';

function limpiarCaducados() {
  const ahora = Date.now();
  for (const [k, p] of pendientes) if (ahora - p.creado > PENDIENTE_MS) pendientes.delete(k);
  for (const [k, e] of esperando) if (ahora > e.hasta) esperando.delete(k);
}

// Solo contesta a quien está en la lista. A los demás les dice su número, para poder darse de alta.
bot.use(async (ctx, next) => {
  const uid = String(ctx.from?.id || '');
  if (permitidos.has(uid)) return next();
  if (ctx.message) {
    console.log(`Mensaje de un usuario no autorizado: ${uid}`);
    await ctx.reply(`Este bot es privado. Tu número de Telegram es ${uid}.`);
  }
});

function hoyISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function fechaBonita(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function tarjeta(p) {
  const lineas = [
    `🧾 ${p.comercio || '¿comercio?'}`,
    `${p.cents ? formatoEuros(p.cents) : '¿importe?'} · ${fechaBonita(p.fecha)}${p.fechaDudosa ? ' (¿es esta la fecha?)' : ''}`,
    `Categoría: ${p.nombreCat || 'sin categoría'}`,
  ];
  return lineas.join('\n');
}

function botones(id, p) {
  const k = new InlineKeyboard();
  if (p.cents) k.text('✅ Guardar', `ok:${id}`);
  k.text('✏️ Importe', `ed:${id}:cents`).row();
  k.text('🏪 Comercio', `ed:${id}:comercio`).text('📅 Fecha', `ed:${id}:fecha`).row();
  k.text('🏷️ Categoría', `cat:${id}`).text('✖️ Descartar', `no:${id}`);
  return k;
}

async function nombreCategoria(catId) {
  if (!catId) return null;
  return (await actual.categorias()).find((c) => c.id === catId)?.nombre || null;
}

// Importe escrito a mano: solo números, con coma o punto y hasta dos decimales ("23,40", "23.4", "23").
function importeEscrito(t) {
  const s = t.replace(/[€\s]/g, '');
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(s)) return null;
  const [ent, dec = ''] = s.split(/[.,]/);
  return Number(ent) * 100 + Number(dec.padEnd(2, '0'));
}

// Fecha escrita a mano: "12/11" o "12/11/2026". Rechaza fechas imposibles como 31/02.
function fechaEscrita(t) {
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[1])) return null;
  return d.toISOString().slice(0, 10);
}

bot.command('start', (ctx) =>
  ctx.reply(`Mándame la foto de un ticket y lo apunto en ${actual.nombre}. También vale escribir "12,50 bar".`),
);

bot.on('message:photo', async (ctx) => {
  limpiarCaducados();
  const aviso = await ctx.reply('📸 Leyendo el ticket…');
  let p;
  try {
    const foto = ctx.message.photo.at(-1); // la de más resolución
    const file = await ctx.api.getFile(foto.file_id);
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!res.ok) throw new Error(`Telegram devolvió ${res.status} al descargar la foto`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const r = await leerFoto(buffer); // la foto pasa por ficheros temporales que se borran al terminar
    const categoria = await actual.categoriaSugerida(r.comercio);
    p = {
      fecha: r.fecha, fechaDudosa: !r.seguro?.fecha, cents: r.cents, comercio: r.comercio,
      categoria, nombreCat: await nombreCategoria(categoria), creado: Date.now(),
    };
  } catch (e) {
    console.error('Error leyendo la foto:', e.message);
    await ctx.api.editMessageText(ctx.chat.id, aviso.message_id,
      'No he podido leer la foto. Prueba otra vez, o escríbeme el gasto, por ejemplo "12,50 bar".').catch(() => {});
    return;
  }
  const id = nuevoId();
  pendientes.set(id, p);
  await ctx.api.deleteMessage(ctx.chat.id, aviso.message_id).catch(() => {});
  if (!p.cents) {
    esperando.set(ctx.chat.id, { id, campo: 'cents', hasta: Date.now() + ESPERA_MS });
    return ctx.reply(`${tarjeta(p)}\n\nNo encuentro el total. Escríbemelo, por ejemplo 23,40`, { reply_markup: botones(id, p) });
  }
  return ctx.reply(tarjeta(p), { reply_markup: botones(id, p) });
});

// Una foto mandada como archivo (sin comprimir) no se lee: se avisa en vez de callar.
bot.on('message:document', (ctx) =>
  ctx.reply('Mándamela como foto (no como archivo) y la leo.'),
);

// Atajo sin foto: "12,50 bar de abajo"
bot.on('message:text', async (ctx) => {
  limpiarCaducados();
  const espera = esperando.get(ctx.chat.id);
  const t = ctx.message.text.trim();
  if (espera) {
    const p = pendientes.get(espera.id);
    if (!p) {
      esperando.delete(ctx.chat.id);
    } else {
      if (espera.campo === 'cents') {
        const c = importeEscrito(t);
        if (!c) return ctx.reply('No lo entiendo como importe. Prueba con 23,40');
        p.cents = c;
      } else if (espera.campo === 'fecha') {
        const f = fechaEscrita(t);
        if (!f) return ctx.reply('Escríbela como 12/11 o 12/11/2026');
        p.fecha = f;
        p.fechaDudosa = false;
      } else if (espera.campo === 'comercio') {
        p.comercio = t.slice(0, 40);
        if (!p.categoria) {
          p.categoria = await actual.categoriaSugerida(p.comercio);
          p.nombreCat = await nombreCategoria(p.categoria);
        }
      }
      esperando.delete(ctx.chat.id);
      return ctx.reply(tarjeta(p), { reply_markup: botones(espera.id, p) });
    }
  }
  const m = t.match(/^(\d{1,5}(?:[.,]\d{1,2})?)\s*€?\s+(.+)$/);
  if (!m) return ctx.reply('Mándame una foto del ticket, o escribe algo como "12,50 bar".');
  const cents = importeEscrito(m[1]);
  if (!cents) return ctx.reply('No lo entiendo como importe. Prueba con "12,50 bar".');
  const comercio = m[2].trim().slice(0, 40);
  const categoria = await actual.categoriaSugerida(comercio);
  const p = { fecha: hoyISO(), cents, comercio, categoria, nombreCat: await nombreCategoria(categoria), creado: Date.now() };
  const id = nuevoId();
  pendientes.set(id, p);
  return ctx.reply(tarjeta(p), { reply_markup: botones(id, p) });
});

bot.callbackQuery(new RegExp(`^ok:${ID}$`), async (ctx) => {
  const id = ctx.match[1];
  const p = pendientes.get(id);
  if (!p) return ctx.answerCallbackQuery('Este ticket ya no está pendiente');
  let r;
  try {
    r = await actual.apuntar({ ...p, nota: 'Desde Telegram' });
  } catch (e) {
    console.error(`Error apuntando en ${actual.nombre}:`, e.message);
    return ctx.answerCallbackQuery({ text: `No he podido apuntarlo en ${actual.nombre}. Prueba otra vez en un rato.`, show_alert: true });
  }
  pendientes.delete(id);
  await ctx.answerCallbackQuery('Apuntado');
  const mes = new Date().toLocaleString('es-ES', { month: 'long', timeZone: 'Europe/Madrid' });
  const llevas = r?.totalMesCents ? `\n\nLlevas ${formatoEuros(r.totalMesCents)} en ${mes}.` : '';
  return ctx.editMessageText(`✅ Apuntado en ${actual.nombre}\n${p.comercio || 'Ticket'} · −${formatoEuros(p.cents)} · ${fechaBonita(p.fecha)}${p.nombreCat ? ` · ${p.nombreCat}` : ''}${llevas}`);
});

bot.callbackQuery(new RegExp(`^no:${ID}$`), async (ctx) => {
  pendientes.delete(ctx.match[1]);
  await ctx.answerCallbackQuery();
  return ctx.editMessageText('✖️ Descartado, no se ha apuntado nada.');
});

bot.callbackQuery(new RegExp(`^ed:${ID}:(cents|comercio|fecha)$`), async (ctx) => {
  const [, id, campo] = ctx.match;
  if (!pendientes.has(id)) return ctx.answerCallbackQuery('Este ticket ya no está pendiente');
  esperando.set(ctx.chat.id, { id, campo, hasta: Date.now() + ESPERA_MS });
  await ctx.answerCallbackQuery();
  const pide = { cents: 'el importe (23,40)', comercio: 'el comercio', fecha: 'la fecha (12/11)' }[campo];
  return ctx.reply(`Escríbeme ${pide}`);
});

bot.callbackQuery(new RegExp(`^cat:${ID}$`), async (ctx) => {
  const id = ctx.match[1];
  if (!pendientes.has(id)) return ctx.answerCallbackQuery('Este ticket ya no está pendiente');
  const cats = await actual.categorias();
  const k = new InlineKeyboard();
  cats.slice(0, 40).forEach((c, i) => {
    k.text(c.nombre, `pc:${id}:${c.id}`); // por id, no por posición: la lista puede cambiar entre medias
    if (i % 2 === 1) k.row();
  });
  await ctx.answerCallbackQuery();
  return ctx.editMessageReplyMarkup({ reply_markup: k });
});

bot.callbackQuery(new RegExp(`^pc:${ID}:([0-9a-f-]{36})$`), async (ctx) => {
  const [, id, catId] = ctx.match;
  const p = pendientes.get(id);
  if (!p) return ctx.answerCallbackQuery('Este ticket ya no está pendiente');
  const c = (await actual.categorias()).find((x) => x.id === catId);
  p.categoria = c?.id || null;
  p.nombreCat = c?.nombre || null;
  await ctx.answerCallbackQuery();
  return ctx.editMessageText(tarjeta(p), { reply_markup: botones(id, p) });
});

bot.catch((err) => console.error('Error en el bot:', err.error?.message || err));

await actual.conectar();
console.log(`Conectado a ${actual.nombre}. Bot escuchando.`);
process.once('SIGTERM', async () => { await bot.stop(); await actual.cerrar(); });
process.once('SIGINT', async () => { await bot.stop(); await actual.cerrar(); });
bot.start();
