// Conexión con Actual por su API oficial (@actual-app/api).
import fs from 'node:fs';
import * as api from '@actual-app/api';

const cfg = {
  dataDir: process.env.DATA_DIR || './data',
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
  syncId: process.env.ACTUAL_SYNC_ID,
  budgetPassword: process.env.ACTUAL_BUDGET_PASSWORD || undefined, // solo si el presupuesto va cifrado
  cuenta: process.env.ACTUAL_ACCOUNT, // nombre de la cuenta donde se apuntan los tickets
};

export const nombre = 'Actual';

let cuentaId = null;

export async function conectar() {
  for (const k of ['serverURL', 'password', 'syncId', 'cuenta']) if (!cfg[k]) throw new Error(`Falta la variable de ${k}`);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  await api.init({ dataDir: cfg.dataDir, serverURL: cfg.serverURL, password: cfg.password });
  await api.downloadBudget(cfg.syncId, cfg.budgetPassword ? { password: cfg.budgetPassword } : undefined);
  const cuentas = await api.getAccounts();
  const c = cuentas.find((a) => a.name.toLowerCase() === cfg.cuenta.toLowerCase() && !a.closed);
  if (!c) throw new Error(`No encuentro la cuenta "${cfg.cuenta}". Hay: ${cuentas.map((a) => a.name).join(', ')}`);
  cuentaId = c.id;
}

export async function categorias() {
  await api.sync();
  const [cats, grupos] = await Promise.all([api.getCategories(), api.getCategoryGroups()]);
  const ingresos = new Set(grupos.filter((g) => g.is_income).map((g) => g.id));
  return cats.filter((c) => !c.hidden && !ingresos.has(c.group_id)).map((c) => ({ id: c.id, nombre: c.name }));
}

// La categoría que usaste la última vez con ese comercio, si existe.
export async function categoriaSugerida(comercio) {
  if (!comercio) return null;
  await api.sync();
  const payees = await api.getPayees();
  const p = payees.find((x) => x.name.toLowerCase() === comercio.toLowerCase());
  if (!p) return null;
  const { data } = await api.aqlQuery(
    api.q('transactions').filter({ payee: p.id, category: { $ne: null } }).orderBy({ date: 'desc' }).limit(1).select(['category']),
  );
  return data[0]?.category || null;
}

export async function apuntar({ fecha, cents, comercio, categoria, nota }) {
  await api.sync();
  // addTransactions y no importTransactions: importar busca un movimiento parecido (mismo importe, ±7 días) y lo
  // fusiona, así que el segundo café de 1,50 € de la semana desaparecería. Lo que confirmas con Guardar se añade siempre.
  await api.addTransactions(cuentaId, [
    { date: fecha, amount: -Math.abs(cents), payee_name: comercio || 'Ticket', category: categoria || undefined, notes: nota, cleared: false },
  ]);
  await api.sync();
}

export async function cerrar() {
  await api.shutdown();
}
