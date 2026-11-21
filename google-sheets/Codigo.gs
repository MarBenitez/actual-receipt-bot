/** @OnlyCurrentDoc */
/**
 * Bot de gastos → Google Sheets (v2)
 *
 * Este código va pegado dentro de tu hoja (Extensiones > Apps Script). Hace cuatro cosas:
 *  1. "Configurar la hoja" monta las pestañas Resumen, Gastos, Categorías y Mi estilo, con sus gráficos.
 *  2. Recibe los gastos que le manda tu bot de Telegram y los apunta en Gastos.
 *  3. Le contesta al bot lo que llevas gastado este mes.
 *  4. Pinta la hoja con TU estilo: eliges tema, colores, letra y emojis en "Mi estilo" y se aplica sola.
 *
 * Solo acepta gastos que lleguen con tu secreto (lo crea "Configurar la hoja"; lo ves en el menú Bot de gastos).
 * El bot le manda la fila ya leída (fecha, comercio, importe, categoría y nota), nunca la foto.
 */

// Categorías de partida: nombre, emoji y presupuesto al mes (cámbialos en la pestaña Categorías).
// Pensadas para un sueldo de 1.800 € al mes con 350 € de ahorro: 1.450 € de presupuesto.
var CATEGORIAS = [
  ['Alquiler', '🔑', 750], ['Supermercado', '🛒', 250], ['Casa y facturas', '💡', 110], ['Restaurantes y bares', '🍻', 90],
  ['Transporte', '🚌', 90], ['Salud', '💊', 25], ['Ropa', '👕', 45], ['Ocio', '🎟️', 40],
  ['Suscripciones', '📺', 30], ['Otros', '📦', 20],
];
var SUELDO = 1800; // sueldo de partida (cámbialo en la pestaña Categorías)
var AHORRO = 350;  // lo que quieres ahorrar cada mes
var CELDA_SUELDO = 'H2'; // en Categorías
var CELDA_AHORRO = 'H5'; // en Categorías
// Gastos fijos que no cuentan en "Donde más se te va" (siempre ganarían).
var FIJOS = ['Alquiler', 'Hipoteca'];
var MAX_CAT = 12; // el Resumen enseña las 12 primeras categorías

// Temas de "Mi estilo". Cada uno trae sus colores y una paleta para las categorías.
var TEMAS = {
  'Menta': { principal: '#0E9F6E', pagina: '#F4FAF7', tarjeta: '#FFFFFF', texto: '#14211B', suave: '#6B7C74', lineas: '#DDEBE4', rojo: '#E5484D', verde: '#0E9F6E',
    cats: ['#0E9F6E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16', '#EC4899', '#64748B', '#14B8A6', '#A855F7'] },
  'Rosa': { principal: '#E11D74', pagina: '#FFF4F8', tarjeta: '#FFFFFF', texto: '#2A1520', suave: '#8A6B7A', lineas: '#F5DCE7', rojo: '#D92D20', verde: '#12B76A',
    cats: ['#E11D74', '#F472B6', '#FB923C', '#A855F7', '#F43F5E', '#C084FC', '#FDBA74', '#FB7185', '#E879F9', '#94A3B8', '#F9A8D4', '#7C3AED'] },
  'Lavanda': { principal: '#6D5DFC', pagina: '#F6F5FF', tarjeta: '#FFFFFF', texto: '#1E1B3A', suave: '#7C7A99', lineas: '#E4E1FA', rojo: '#E5484D', verde: '#16A34A',
    cats: ['#6D5DFC', '#22C1C3', '#F7B32B', '#FF6B8B', '#A78BFA', '#38BDF8', '#FB923C', '#4ADE80', '#F472B6', '#94A3B8', '#2DD4BF', '#C084FC'] },
  'Arena': { principal: '#C2410C', pagina: '#FBF7F2', tarjeta: '#FFFFFF', texto: '#2B2118', suave: '#857565', lineas: '#EDE2D5', rojo: '#B42318', verde: '#3F7D20',
    cats: ['#C2410C', '#D97706', '#65A30D', '#0F766E', '#9A3412', '#A16207', '#B45309', '#4D7C0F', '#BE185D', '#78716C', '#0E7490', '#7C2D12'] },
};
var LETRAS = ['Inter', 'Poppins', 'DM Sans', 'Nunito', 'Space Grotesk', 'Lora'];
// Filas de "Mi estilo": [etiqueta, clave]. El valor va en la columna C y la muestra del color en la D.
var ESTILO = [
  ['Tema', 'tema'], ['Título', 'titulo'], ['Emoji del título', 'emoji'], ['Letra', 'letra'],
  ['Color principal', 'principal'], ['Fondo de la página', 'pagina'], ['Fondo de las tarjetas', 'tarjeta'],
  ['Texto', 'texto'], ['Texto suave', 'suave'], ['Líneas y fondo de las barras', 'lineas'],
  ['Cuando te pasas', 'rojo'], ['Cuando vas bien', 'verde'],
];
var COLORES = ['principal', 'pagina', 'tarjeta', 'texto', 'suave', 'lineas', 'rojo', 'verde'];
var FILA_ESTILO = 6; // primera fila de los ajustes en "Mi estilo"

// ---------- Lo que pide el bot (igual que en la v1) ----------

function doPost(e) {
  var r;
  try {
    var d = JSON.parse(e.postData.contents);
    var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO');
    if (!secreto || d.secreto !== secreto) r = { ok: false, error: 'secreto' };
    else if (d.accion === 'ping') r = { ok: true };
    else if (d.accion === 'categorias') r = { ok: true, categorias: categorias_() };
    else if (d.accion === 'sugerida') r = { ok: true, categoria: sugerida_(d.comercio) };
    else if (d.accion === 'apuntar') r = apuntar_(d);
    else r = { ok: false, error: 'acción desconocida' };
  } catch (err) {
    r = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function categorias_() {
  var h = hoja_('Categorías');
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, 1).getDisplayValues()
    .map(function (f) { return String(f[0]).trim(); })
    .filter(function (n) { return n; });
}

// La categoría que usaste la última vez con ese comercio.
function sugerida_(comercio) {
  var h = hoja_('Gastos');
  var n = h.getLastRow() - 1;
  if (!comercio || n < 1) return null;
  var filas = h.getRange(2, 2, n, 3).getDisplayValues(); // Comercio, Importe, Categoría
  var buscado = String(comercio).trim().toLowerCase();
  for (var i = filas.length - 1; i >= 0; i--) {
    if (String(filas[i][0]).trim().toLowerCase() === buscado && filas[i][2]) return filas[i][2];
  }
  return null;
}

function apuntar_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha))) return { ok: false, error: 'fecha no válida' };
  var importe = Number(d.importe);
  if (!(importe > 0)) return { ok: false, error: 'importe no válido' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var h = hoja_('Gastos');
    // La fecha se convierte en la zona horaria de la hoja, para que cuente en el mes que toca.
    var fecha = Utilities.parseDate(String(d.fecha), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    h.appendRow([fecha, String(d.comercio || 'Ticket').slice(0, 60), importe, String(d.categoria || ''), String(d.nota || ''), new Date()]);
    SpreadsheetApp.flush();
    var total = SpreadsheetApp.getActive().getRangeByName('TotalMes').getValue();
    return { ok: true, totalMes: Number(total) || 0 };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Montar la hoja ----------

/** Monta (o vuelve a montar) toda la hoja y crea tu secreto. Se puede repetir sin perder tus gastos ni tu estilo. */
function configurar() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetLocale('es_ES');
  ss.setSpreadsheetTimeZone('Europe/Madrid');

  var gastos = hoja_('Gastos', true);
  var cats = hoja_('Categorías', true);
  var estilo = hoja_('Mi estilo', true);
  var calc = hoja_('Cálculos', true);
  var res = hoja_('Resumen', true);

  montarCategorias_(cats);
  montarGastos_(gastos);
  montarEstilo_(estilo);
  rellenarColores_(cats);
  montarCalculos_(ss, calc);
  montarResumen_(res);

  // Orden de las pestañas: Resumen, Gastos, Categorías, Mi estilo (Cálculos, oculta, al final).
  ['Resumen', 'Gastos', 'Categorías', 'Mi estilo', 'Cálculos'].forEach(function (n, i) {
    ss.setActiveSheet(ss.getSheetByName(n));
    ss.moveActiveSheet(i + 1);
  });
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0) ss.deleteSheet(hoja1);

  aplicarEstilo();
  ss.setActiveSheet(res);
  calc.hideSheet();

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRETO')) props.setProperty('SECRETO', Utilities.getUuid().replace(/-/g, ''));
  console.log('Hoja lista. Tu secreto para el bot (SHEETS_SECRET) lo ves en el menú Bot de gastos > Ver mi secreto.');
}

function montarGastos_(h) {
  h.getRange(1, 1, 1, 6).setValues([['Fecha', 'Comercio', 'Importe', 'Categoría', 'Nota', 'Apuntado']]);
  h.setFrozenRows(1);
  h.getRange('A2:A').setNumberFormat('dd/mm/yyyy');
  h.getRange('C2:C').setNumberFormat('#,##0.00 "€"');
  h.getRange('F2:F').setNumberFormat('dd/mm/yyyy hh:mm');
  [110, 230, 110, 200, 170, 140].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  // La categoría se elige de la lista de Categorías (también si apuntas algo a mano).
  var regla = SpreadsheetApp.newDataValidation()
    .requireValueInRange(SpreadsheetApp.getActive().getSheetByName('Categorías').getRange('A2:A'), true)
    .setAllowInvalid(true).build();
  h.getRange('D2:D').setDataValidation(regla);
  if (!h.getFilter()) h.getRange(1, 1, Math.max(2, h.getMaxRows()), 6).createFilter();
}

function montarCategorias_(h) {
  h.getRange('A1:D1').setValues([['Categoría', 'Emoji', 'Presupuesto al mes', 'Color']]);
  h.setFrozenRows(1);
  if (h.getRange('A2').getValue() === '') { // sin categorías (la columna F lleva las instrucciones: no vale getLastRow)
    h.getRange(2, 1, CATEGORIAS.length, 3).setValues(CATEGORIAS);
  } else {
    // Hoja de la v1 (solo nombres): se completan emoji y presupuesto donde estén vacíos.
    var n = Math.max(1, h.getRange('A:A').getValues().filter(String).length - 1);
    var filas = h.getRange(2, 1, n, 3).getValues();
    filas.forEach(function (f) {
      var base = CATEGORIAS.filter(function (c) { return c[0] === f[0]; })[0];
      if (f[0] && f[1] === '') f[1] = base ? base[1] : '📦';
      if (f[0] && f[2] === '') f[2] = base ? base[2] : 0;
    });
    h.getRange(2, 1, n, 3).setValues(filas);
  }
  h.getRange('C2:C').setNumberFormat('#,##0 "€"');
  h.getRange('B2:B').setHorizontalAlignment('center');
  [220, 80, 160, 110, 24, 460].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.getRange('H1').setValue('💶 Tu sueldo al mes');
  if (h.getRange(CELDA_SUELDO).getValue() === '') h.getRange(CELDA_SUELDO).setValue(SUELDO);
  h.getRange(CELDA_SUELDO).setNumberFormat('#,##0 "€"').setFontWeight('bold').setFontSize(14);
  h.getRange('H4').setValue('🐷 Quiero ahorrar al mes');
  if (h.getRange(CELDA_AHORRO).getValue() === '') h.getRange(CELDA_AHORRO).setValue(AHORRO);
  h.getRange(CELDA_AHORRO).setNumberFormat('#,##0 "€"').setFontWeight('bold').setFontSize(14);
  h.setColumnWidth(7, 24);
  h.setColumnWidth(8, 170);
  h.getRange('F1').setValue('Cómo se usa');
  h.getRange('F2:F6').setValues([
    ['• Añade, cambia o borra categorías en la columna A. El bot las ve en un minuto.'],
    ['• El emoji es el que sale en el Resumen. Copia cualquiera de tu móvil.'],
    ['• El presupuesto es lo que quieres gastar como mucho al mes. Con 0, sin barra.'],
    ['• El color va como #RRGGBB. Al cambiar de tema en "Mi estilo" se ponen los del tema.'],
    ['• El Resumen enseña las ' + MAX_CAT + ' primeras.'],
  ]);
  h.getRange('F7').setValue('• Pon tu sueldo en ' + CELDA_SUELDO + ' y lo que quieres ahorrar en ' + CELDA_AHORRO + ': el Resumen te dice cuánto te queda para gastar sin tocar ese ahorro.');
  h.getRange('F8').setFormula(F_('=IF(H2="","","• Tus presupuestos suman "&TEXT(SUM(C2:C),"#,##0")&" €. Sueldo menos ahorro: "&TEXT(H2-H5,"#,##0")&" €."&IF(SUM(C2:C)>H2-H5," Te pasas: baja algún presupuesto.",""))'));
}

// Las categorías sin color reciben uno de la paleta de tu tema.
function rellenarColores_(cats) {
  var n = Math.max(0, cats.getLastRow() - 1);
  if (!n) return;
  var paleta = (TEMAS[estilo_().tema] || TEMAS['Menta']).cats;
  var r = cats.getRange(2, 4, n, 1);
  r.setValues(r.getDisplayValues().map(function (f, i) { return [esColor_(f[0]) ? f[0] : paleta[i % paleta.length]]; }));
}

function montarEstilo_(h) {
  h.setHiddenGridlines(true);
  [24, 230, 190, 90, 24, 460].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  h.getRange('B2').setValue('🎨 Mi estilo');
  h.getRange('B3').setValue('Esta hoja es tuya. Elige un tema o cambia cualquier color, la letra, el título o el emoji, y la hoja entera se pinta sola.');
  h.getRange('B4').setValue('Los colores van como #RRGGBB (los sacas de cualquier web de paletas). Los de cada categoría están en la pestaña Categorías.');
  var hayValores = h.getRange(FILA_ESTILO, 3).getValue() !== '';
  var t = TEMAS['Menta'];
  var defecto = { tema: 'Menta', titulo: 'Mis gastos', emoji: '🧾', letra: 'Inter' };
  ESTILO.forEach(function (e, i) {
    var f = FILA_ESTILO + i;
    h.getRange(f, 2).setValue(e[0]);
    if (!hayValores) h.getRange(f, 3).setValue(defecto[e[1]] !== undefined ? defecto[e[1]] : t[e[1]]);
  });
  h.getRange(FILA_ESTILO, 3).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(TEMAS).concat(['Personalizado']), true).build());
  h.getRange(FILA_ESTILO + 3, 3).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(LETRAS, true).setAllowInvalid(true).build());
  h.getRange('F' + FILA_ESTILO).setValue('Al cambiar el tema se ponen sus colores (también los de las categorías). Luego retoca el que quieras.');
  h.getRange('F' + (FILA_ESTILO + 3)).setValue('Vale cualquier letra de Google Fonts.');
}

// Pestaña oculta con los números que usan el Resumen y los gráficos. No hace falta tocarla.
function montarCalculos_(ss, h) {
  h.clear();
  h.getRange('A1:Z300').clearDataValidations();
  var G = 'Gastos!';
  var SEL = "'Resumen'!$I$2";

  // Meses que se pueden elegir en el Resumen: "Este mes" y los 11 anteriores.
  h.getRange('A3:B3').setValues([['Mes (lista)', 'Empieza']]);
  for (var i = 0; i < 12; i++) {
    var r = 4 + i;
    h.getRange('B' + r).setFormula(F_('=EOMONTH(TODAY(),-' + (i + 1) + ')+1'));
    h.getRange('A' + r).setFormula(F_(i === 0 ? '="Este mes"' : '=PROPER(TEXT(B' + r + ',"mmmm yyyy"))'));
  }
  h.getRange('B4:B15').setNumberFormat('dd/mm/yyyy');

  // Números del mes elegido (columna B; la C dice qué es cada uno).
  var filas = [
    [1, 'Mes elegido', '=IFERROR(VLOOKUP(' + SEL + ',A4:B15,2,FALSE),EOMONTH(TODAY(),-1)+1)', 'dd/mm/yyyy'],
    [2, 'Fin del mes', '=EOMONTH(B1,0)', 'dd/mm/yyyy'],
    [16, 'Es el mes actual', '=B1=EOMONTH(TODAY(),-1)+1', null],
    [17, 'Mes anterior: empieza', '=EDATE(B1,-1)', 'dd/mm/yyyy'],
    [18, 'Mes anterior: hasta', '=IF(B16,MIN(EDATE(TODAY(),-1),EOMONTH(B17,0)),EOMONTH(B17,0))', 'dd/mm/yyyy'],
    [19, 'Gastado en el mes', '=SUMIFS(' + G + 'C:C,' + G + 'A:A,">="&B1,' + G + 'A:A,"<="&B2)', '#,##0.00'],
    [20, 'Gastado en el anterior', '=SUMIFS(' + G + 'C:C,' + G + 'A:A,">="&B17,' + G + 'A:A,"<="&B18)', '#,##0.00'],
    [21, 'Tickets del mes', '=COUNTIFS(' + G + 'A:A,">="&B1,' + G + 'A:A,"<="&B2)', '0'],
    [22, 'Presupuesto total', "=SUM('Categorías'!C2:C)", '#,##0'],
    [23, 'Días que quedan', '=EOMONTH(TODAY(),0)-TODAY()+1', '0'],
    [25, 'Sueldo', "=N('Categorías'!$H$2)", '#,##0'],
    [27, 'Ahorro que quieres', "=N('Categorías'!$H$5)", '#,##0'],
    [28, 'Para gastar (sueldo - ahorro)', '=B25-B27', '#,##0'],
    [26, 'Gastado sin fijos (máx. categoría)', '=MAX(FILTER(F4:F15,ISNA(MATCH(D4:D15,{"Alquiler";"Hipoteca"},0))))', '#,##0.00'],
    [24, 'Este mes (para el bot)', '=SUMIFS(' + G + 'C:C,' + G + 'A:A,">="&EOMONTH(TODAY(),-1)+1,' + G + 'A:A,"<="&EOMONTH(TODAY(),0))', '#,##0.00'],
  ];
  filas.forEach(function (f) {
    h.getRange('C' + f[0]).setValue(f[1]);
    h.getRange('B' + f[0]).setFormula(F_(f[2]));
    if (f[3]) h.getRange('B' + f[0]).setNumberFormat(f[3]);
  });
  ss.setNamedRange('TotalMes', h.getRange('B24')); // lo que el bot te contesta ("Llevas X € en noviembre")

  // Categorías del mes elegido (D-I) y las opciones de cada barra (N-O, 4 filas por categoría).
  h.getRange('D3:I3').setValues([['Categoría', 'Etiqueta', 'Gastado', 'Presupuesto', 'Hecho', 'Falta']]);
  var ROJO = "'Mi estilo'!$C$" + filaEstilo_('rojo');
  var PRINCIPAL = "'Mi estilo'!$C$" + filaEstilo_('principal');
  var LINEAS = "'Mi estilo'!$C$" + filaEstilo_('lineas');
  for (var c = 0; c < MAX_CAT; c++) {
    var f = 4 + c;
    var k = c + 1;
    var colorCat = "IFERROR(INDEX('Categorías'!D2:D," + k + '),"")';
    h.getRange('D' + f).setFormula(F_("=IFERROR(INDEX('Categorías'!A2:A," + k + '),"")'));
    h.getRange('E' + f).setFormula(F_('=IF(D' + f + '="","",TRIM(IFERROR(INDEX(\'Categorías\'!B2:B,' + k + '),"")&" "&D' + f + '))'));
    h.getRange('F' + f).setFormula(F_('=IF(D' + f + '="",0,SUMIFS(' + G + 'C:C,' + G + 'D:D,D' + f + ',' + G + 'A:A,">="&$B$1,' + G + 'A:A,"<="&$B$2))'));
    h.getRange('G' + f).setFormula(F_('=IF(D' + f + '="",0,N(INDEX(\'Categorías\'!C2:C,' + k + ')))'));
    h.getRange('H' + f).setFormula(F_('=IF(G' + f + '<=0,0,MIN(1,F' + f + '/G' + f + '))'));
    h.getRange('I' + f).setFormula('=1-H' + f);
    var o = 4 + c * 4;
    h.getRange('N' + o + ':O' + (o + 1)).setValues([['charttype', 'bar'], ['max', 1]]);
    h.getRange('N' + (o + 2)).setValue('color1');
    h.getRange('O' + (o + 2)).setFormula(F_('=IF(F' + f + '>G' + f + ',' + ROJO + ',IF(' + colorCat + '="",' + PRINCIPAL + ',' + colorCat + '))'));
    h.getRange('N' + (o + 3)).setValue('color2');
    h.getRange('O' + (o + 3)).setFormula('=' + LINEAS);
  }

  // Últimos 6 meses (K-L), para las barras "Mes a mes".
  h.getRange('K3:L3').setValues([['Mes', 'Gastado']]);
  for (var m = 0; m < 6; m++) {
    var rr = 4 + m;
    var atras = 5 - m;
    h.getRange('K' + rr).setFormula(F_('=PROPER(TEXT(EOMONTH(TODAY(),-' + (atras + 1) + ')+1,"mmm"))'));
    h.getRange('L' + rr).setFormula(F_('=SUMIFS(' + G + 'C:C,' + G + 'A:A,">="&EOMONTH(TODAY(),-' + (atras + 1) + ')+1,' + G + 'A:A,"<="&EOMONTH(TODAY(),-' + atras + '))'));
  }
}

function montarResumen_(h) {
  h.getCharts().forEach(function (c) { h.removeChart(c); });
  h.getRange('A1:Z200').breakApart();
  h.clear();
  h.getRange('A1:Z200').clearDataValidations();
  h.setConditionalFormatRules([]);
  h.setHiddenGridlines(true);
  var C = "'Cálculos'!";

  // Rejilla: dos columnas de 560 px (B-E y G-J) con un pasillo en F. Cabe entero en una pantalla 16:9.
  [20, 170, 110, 170, 110, 24, 140, 140, 140, 140, 20].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
  [[1, 14], [2, 52], [3, 24], [4, 12], [5, 26], [6, 50], [7, 26], [8, 18], [9, 34], [10, 24], [23, 18], [24, 34]]
    .forEach(function (r) { h.setRowHeight(r[0], r[1]); });
  for (var r = 11; r < 11 + MAX_CAT; r++) h.setRowHeight(r, 30);

  // Cabecera: título (lo pone aplicarEstilo), el mes y el selector de mes.
  h.getRange('B3').setFormula(F_('=PROPER(TEXT(' + C + 'B1,"mmmm yyyy"))&IF(COUNTIF(Gastos!E:E,"Ejemplo")>0,"   ·   con datos de ejemplo","")'));
  h.getRange('H2').setValue('Mes').setHorizontalAlignment('right').setVerticalAlignment('middle');
  h.getRange('I2:J2').merge().setValue('Este mes').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(SpreadsheetApp.getActive().getRange("'Cálculos'!A4:A15"), true).build());

  // Tarjetas: lo gastado, lo que queda, cómo vas contra el mes pasado y dónde más se te va.
  var tarjetas = [
    ['B', 'C', 'Llevas gastado', '=' + C + 'B19', '#,##0.00 "€"',
      '=' + C + 'B21&IF(' + C + 'B21=1," ticket"," tickets")&" · media "&TEXT(IFERROR(' + C + 'B19/' + C + 'B21,0),"0")&" €"'],
    ['D', 'E', 'Te queda para gastar', '=IF(' + C + 'B25>0,' + C + 'B28-' + C + 'B19,' + C + 'B22-' + C + 'B19)', '#,##0 "€"',
      '=IF(' + C + 'B25>0,"de "&TEXT(' + C + 'B28,"#,##0")&" € (ahorras "&TEXT(' + C + 'B27,"#,##0")&" €)"&IF(' + C + 'B16," · "&TEXT(MAX(0,' + C + 'B28-' + C + 'B19)/' + C + 'B23,"0")&" € al día",""),IF(' + C + 'B22=0,"Pon tu sueldo en Categorías","de "&TEXT(' + C + 'B22,"0")&" € de presupuesto"))'],
    ['G', 'H', 'Vs. mes pasado', '=' + C + 'B19-' + C + 'B20', '+#,##0 "€";-#,##0 "€";0 "€"',
      '=IF(' + C + 'B16,"que el mes pasado a estas alturas","que el mes anterior")'],
    ['I', 'J', 'Donde más se te va', '=IF(N(' + C + 'B26)=0,"—",INDEX(' + C + 'E4:E15,MATCH(' + C + 'B26,' + C + 'F4:F15,0)))', null,
      '=IF(N(' + C + 'B26)=0,"todavía sin gastos",TEXT(' + C + 'B26,"0")&" € · sin contar el alquiler")'],
  ];
  tarjetas.forEach(function (t) {
    h.getRange(t[0] + '5:' + t[1] + '5').merge().setValue(t[2]);
    var v = h.getRange(t[0] + '6:' + t[1] + '6').merge();
    v.setFormula(F_(t[3]));
    if (t[4]) v.setNumberFormat(t[4]);
    h.getRange(t[0] + '7:' + t[1] + '7').merge().setFormula(F_(t[5]));
  });

  // Presupuesto por categoría (B-E), con una barra por categoría que se pone roja si te pasas.
  h.getRange('B9').setValue('Presupuesto por categoría');
  h.getRange('B10:E10').setValues([['Categoría', 'Gastado', 'Del presupuesto', 'Queda']]);
  for (var c = 0; c < MAX_CAT; c++) {
    var f = 11 + c;
    var k = 4 + c;
    var o = 4 + c * 4;
    h.getRange('B' + f).setFormula('=' + C + 'E' + k);
    h.getRange('C' + f).setFormula(F_('=IF(B' + f + '="","",' + C + 'F' + k + ')'));
    h.getRange('D' + f).setFormula(F_('=IF(OR(B' + f + '="",' + C + 'G' + k + '<=0),"",SPARKLINE(' + C + 'H' + k + ':I' + k + ',' + C + 'N' + o + ':O' + (o + 3) + '))'));
    h.getRange('E' + f).setFormula(F_('=IF(B' + f + '="","",IF(' + C + 'G' + k + '<=0,"sin presupuesto",IF(' + C + 'F' + k + '>' + C + 'G' + k +
      ',"+"&TEXT(' + C + 'F' + k + '-' + C + 'G' + k + ',"0")&" € de más",TEXT(' + C + 'G' + k + '-' + C + 'F' + k + ',"0")&" € libres")))'));
  }
  h.getRange('C11:C22').setNumberFormat('#,##0.00 "€"');

  // A la derecha: el anillo por categoría (lo inserta aplicarEstilo, con tus colores).
  h.getRange('G9').setValue('En qué se me va');

  // Abajo: mes a mes (gráfico de aplicarEstilo), en qué comercios más, y los últimos gastos.
  h.getRange('B24').setValue('Mes a mes');
  h.getRange('G24').setValue('Dónde más gasto');
  var ini = 'TEXT(' + C + 'B1,"yyyy-mm-dd")';
  var fin = 'TEXT(' + C + 'B2,"yyyy-mm-dd")';
  h.getRange('G25').setFormula(F_('=IFERROR(QUERY(Gastos!A2:D,"select B, count(C), sum(C) where A >= date \'"&' + ini +
    '&"\' and A <= date \'"&' + fin + '&"\' group by B order by sum(C) desc limit 5 label B \'Comercio\', count(C) \'Veces\', sum(C) \'Total\'",0),"Sin gastos este mes")'));
  h.getRange('I26:I30').setNumberFormat('#,##0.00 "€"');
  h.getRange('H25:H30').setHorizontalAlignment('center');

  h.getRange('G32').setValue('Últimos gastos');
  var cols = [['G', 'Fecha', 'A'], ['H', 'Comercio', 'B'], ['I', 'Importe', 'C'], ['J', 'Categoría', 'D']];
  var hay = 'Gastos!A2:A<>""';
  cols.forEach(function (c) {
    h.getRange(c[0] + '33').setValue(c[1]);
    h.getRange(c[0] + '34').setFormula(F_('=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(Gastos!' + c[2] + '2:' + c[2] + ',' + hay + '),FILTER(Gastos!A2:A,' + hay +
      '),FALSE,FILTER(ROW(Gastos!A2:A),' + hay + '),FALSE),6,1),"")'));
  });
  h.getRange('G34:G39').setNumberFormat('dd/mm');
  h.getRange('I34:I39').setNumberFormat('#,##0.00 "€"');
}

// ---------- Tu estilo ----------

/** Pinta toda la hoja con lo que hay en "Mi estilo" y en los colores de Categorías. */
function aplicarEstilo() {
  var ss = SpreadsheetApp.getActive();
  var s = estilo_();
  var res = ss.getSheetByName('Resumen');
  var gastos = ss.getSheetByName('Gastos');
  var cats = ss.getSheetByName('Categorías');
  var est = ss.getSheetByName('Mi estilo');
  var calc = ss.getSheetByName('Cálculos');
  if (!res || !gastos || !cats || !est || !calc) throw new Error('Falta alguna pestaña. Usa "Configurar la hoja" en el menú Bot de gastos.');
  var linea = SpreadsheetApp.BorderStyle.SOLID;
  var nEst = ESTILO.length;

  [res, gastos, cats, est].forEach(function (h) {
    h.getRange(1, 1, h.getMaxRows(), h.getMaxColumns()).setFontFamily(s.letra).setFontColor(s.texto);
  });

  // Resumen
  res.getRange('A1:Z200').setBackground(s.pagina).setFontSize(10);
  res.getRange('B2').setValue((s.emoji ? s.emoji + ' ' : '') + s.titulo).setFontSize(26).setFontWeight('bold').setVerticalAlignment('middle');
  res.getRange('B3').setFontSize(12).setFontColor(s.suave);
  res.getRange('H2').setFontColor(s.suave).setFontSize(11);
  res.getRange('I2:J2').setBackground(s.tarjeta).setFontWeight('bold').setFontSize(12).setFontColor(s.principal)
    .setBorder(true, true, true, true, false, false, s.principal, linea);
  [['B', 'C'], ['D', 'E'], ['G', 'H'], ['I', 'J']].forEach(function (t) {
    res.getRange(t[0] + '5:' + t[1] + '7').setBackground(s.tarjeta).setHorizontalAlignment('left')
      .setBorder(true, true, true, true, false, false, s.lineas, linea);
    res.getRange(t[0] + '5').setFontColor(s.suave).setFontSize(10).setVerticalAlignment('bottom');
    res.getRange(t[0] + '6').setFontSize(24).setFontWeight('bold').setVerticalAlignment('middle');
    res.getRange(t[0] + '7').setFontColor(s.suave).setFontSize(9).setVerticalAlignment('top');
  });
  res.getRange('B6').setFontColor(s.principal);
  res.getRange('I6').setFontSize(17);
  ['B9', 'G9', 'B24', 'G24', 'G32'].forEach(function (a) { res.getRange(a).setFontSize(14).setFontWeight('bold').setVerticalAlignment('bottom'); });
  [res.getRange('B10:E10'), res.getRange('G25:I25'), res.getRange('G33:J33')].forEach(function (rg) {
    rg.setFontColor(s.suave).setFontSize(9).setFontWeight('normal').setBorder(false, false, true, false, false, false, s.lineas, linea);
  });
  res.getRange('B11:E22').setFontSize(11).setVerticalAlignment('middle')
    .setBorder(false, false, false, false, false, true, s.lineas, linea);
  res.getRange('C11:C22').setFontWeight('bold');
  res.getRange('E11:E22').setFontColor(s.suave).setFontSize(10);
  res.getRange('G26:J39').setFontSize(10);
  res.getRange('I26:I30').setFontWeight('bold');
  res.getRange('I34:I39').setFontWeight('bold');

  res.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(s.rojo).setRanges([res.getRange('D6')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0).setFontColor(s.verde).setRanges([res.getRange('D6')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(s.rojo).setRanges([res.getRange('G6')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThanOrEqualTo(0).setFontColor(s.verde).setRanges([res.getRange('G6')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT(E11)="+"').setFontColor(s.rojo).setBold(true).setRanges([res.getRange('E11:E22')]).build(),
  ]);

  // Gráficos: se rehacen con tus colores (opciones mínimas: con muchas, Sheets los dejaba en blanco).
  res.getCharts().forEach(function (c) { res.removeChart(c); });
  res.insertChart(res.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(calc.getRange('E4:F15'))
    .setPosition(10, 7, 0, 0)
    .setOption('pieHole', 0.6)
    .setOption('legend', { position: 'right' })
    .setOption('colors', coloresCategorias_(cats, s))
    .setOption('backgroundColor', s.pagina)
    .setOption('width', 560).setOption('height', 330)
    .build());
  res.insertChart(res.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(calc.getRange('K4:L9'))
    .setPosition(25, 2, 0, 0)
    .setOption('legend', { position: 'none' })
    .setOption('colors', [s.principal])
    .setOption('backgroundColor', s.pagina)
    .setOption('width', 560).setOption('height', 300)
    .build());

  // Gastos
  gastos.getBandings().forEach(function (b) { b.remove(); });
  gastos.getRange(1, 1, gastos.getMaxRows(), 6).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(s.principal).setFirstRowColor(s.tarjeta).setSecondRowColor(s.pagina);
  gastos.getRange('A1:F1').setFontColor('#FFFFFF').setFontWeight('bold');
  gastos.getRange('F2:F').setFontColor(s.suave);
  gastos.getRange('C2:C').setFontWeight('bold');

  // Categorías: cabecera y la muestra de cada color en su celda.
  est.getRange('A1:F40').setBackground(s.pagina);
  cats.getRange('A1:D1').setBackground(s.principal).setFontColor('#FFFFFF').setFontWeight('bold');
  cats.getRange('F1').setFontWeight('bold').setFontColor(s.principal);
  cats.getRange('F2:F6').setFontColor(s.suave);
  var n = Math.max(0, cats.getLastRow() - 1);
  if (n) {
    var hex = cats.getRange(2, 4, n, 1).getDisplayValues();
    cats.getRange(2, 4, n, 1).setBackgrounds(hex.map(function (f) { return [esColor_(f[0]) ? f[0] : '#FFFFFF']; }))
      .setFontColor('#FFFFFF').setFontWeight('bold');
  }

  // Mi estilo: título y muestra de cada color al lado de su valor.
  est.getRange('B2').setFontSize(22).setFontWeight('bold');
  est.getRange('B3:B4').setFontColor(s.suave);
  est.getRange(FILA_ESTILO, 2, nEst, 1).setFontWeight('bold');
  est.getRange(FILA_ESTILO, 3, nEst, 1).setBackground(s.tarjeta).setBorder(true, true, true, true, true, true, s.lineas, linea);
  est.getRange('F' + FILA_ESTILO + ':F' + (FILA_ESTILO + 3)).setFontColor(s.suave);
  est.getRange(FILA_ESTILO, 4, nEst, 1).setBackgrounds(ESTILO.map(function (e) { return [esColor_(s[e[1]]) ? s[e[1]] : s.pagina]; }));
}

// Lee "Mi estilo". Lo que falte o no sea un color válido se rellena con el tema.
function estilo_() {
  var h = SpreadsheetApp.getActive().getSheetByName('Mi estilo');
  var v = h ? h.getRange(FILA_ESTILO, 3, ESTILO.length, 1).getDisplayValues() : [];
  var leido = {};
  ESTILO.forEach(function (e, i) { leido[e[1]] = v[i] ? String(v[i][0]).trim() : undefined; });
  return completarEstilo_(leido);
}

function completarEstilo_(leido) {
  var base = TEMAS[leido.tema] || TEMAS['Menta'];
  var s = {
    tema: leido.tema || 'Menta', titulo: leido.titulo || 'Mis gastos',
    emoji: leido.emoji === undefined ? '🧾' : leido.emoji, letra: leido.letra || 'Inter',
  };
  COLORES.forEach(function (k) { s[k] = esColor_(leido[k]) ? leido[k] : base[k]; });
  return s;
}

function coloresCategorias_(cats, s) {
  var base = (TEMAS[s.tema] || TEMAS['Menta']).cats;
  var n = Math.min(MAX_CAT, Math.max(0, cats.getLastRow() - 1));
  var hex = n ? cats.getRange(2, 4, n, 1).getDisplayValues() : [];
  var out = [];
  for (var i = 0; i < MAX_CAT; i++) {
    var c = hex[i] ? String(hex[i][0]).trim() : '';
    out.push(esColor_(c) ? c : base[i % base.length]);
  }
  return out;
}

function esColor_(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c || '').trim()); }

function filaEstilo_(clave) {
  for (var i = 0; i < ESTILO.length; i++) if (ESTILO[i][1] === clave) return FILA_ESTILO + i;
  throw new Error('No hay ajuste ' + clave);
}

/** Pone los colores de un tema en "Mi estilo" y en las categorías. */
function ponerTema_(nombre) {
  var t = TEMAS[nombre];
  if (!t) return;
  var ss = SpreadsheetApp.getActive();
  var est = ss.getSheetByName('Mi estilo');
  COLORES.forEach(function (k) { est.getRange(filaEstilo_(k), 3).setValue(t[k]); });
  var cats = ss.getSheetByName('Categorías');
  var n = Math.max(0, cats.getLastRow() - 1);
  if (n) {
    var filas = [];
    for (var i = 0; i < n; i++) filas.push([t.cats[i % t.cats.length]]);
    cats.getRange(2, 4, n, 1).setValues(filas);
  }
}

// Al cambiar algo en "Mi estilo" (o un color en Categorías), la hoja se repinta sola.
function onEdit(e) {
  if (!e || !e.range) return;
  var h = e.range.getSheet();
  var nombre = h.getName();
  var fila = e.range.getRow();
  var col = e.range.getColumn();
  if (nombre === 'Mi estilo' && col === 3 && fila >= FILA_ESTILO && fila < FILA_ESTILO + ESTILO.length) {
    if (fila === FILA_ESTILO) ponerTema_(String(e.range.getValue()));
    else if (fila >= filaEstilo_('principal')) h.getRange(FILA_ESTILO, 3).setValue('Personalizado');
    aplicarEstilo();
  } else if (nombre === 'Categorías' && col <= 4 && col + e.range.getNumColumns() - 1 >= 4) {
    aplicarEstilo();
  }
}

// ---------- Menú dentro de la hoja ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 Bot de gastos')
    .addItem('Configurar la hoja', 'configurar')
    .addItem('🎨 Aplicar mi estilo', 'aplicarEstilo')
    .addItem('Ver mi secreto para el bot', 'verSecreto')
    .addSeparator()
    .addItem('Añadir gastos de ejemplo', 'ejemplo')
    .addItem('Borrar gastos de ejemplo', 'borrarEjemplo')
    .addToUi();
}

function verSecreto() {
  var s = PropertiesService.getScriptProperties().getProperty('SECRETO');
  SpreadsheetApp.getUi().alert(s ? 'Tu secreto (va en SHEETS_SECRET del .env del bot):\n\n' + s + '\n\nNo lo compartas: con él se puede escribir en tu hoja.'
    : 'Todavía no tienes secreto: usa primero "Configurar la hoja".');
}

// ---------- Datos de ejemplo ----------

// Vuelve a poner las categorías de partida (borra las tuyas). Solo para empezar de cero.
function reiniciarCategorias() {
  var h = hoja_('Categorías');
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 4).clearContent();
  h.getRange(CELDA_SUELDO).clearContent();
  h.getRange(CELDA_AHORRO).clearContent();
  configurar();
}

// Gastos inventados de los últimos 5 meses y de lo que va de este, para ver la hoja con vida. Llevan la nota "Ejemplo".
function ejemplo() {
  var hoy = new Date();
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var filas = ejemploFilas_(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).map(function (f) {
    return [Utilities.parseDate(f[0], tz, 'yyyy-MM-dd'), f[1], f[2], f[3], 'Ejemplo', new Date()];
  });
  var h = hoja_('Gastos');
  h.getRange(h.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
  h.getRange(2, 1, h.getLastRow() - 1, 6).sort({ column: 1, ascending: true });
}

// [comercio, categoría, importe típico, veces al mes, día fijo (0 = cualquiera)]
var EJEMPLO = [
  ['Alquiler piso', 'Alquiler', 750, 1, 1], ['Iberdrola', 'Casa y facturas', 48, 1, 9], ['Digi', 'Casa y facturas', 25, 1, 12],
  ['Mercadona', 'Supermercado', 42, 4, 0], ['Lidl', 'Supermercado', 24, 2, 0],
  ['Bar Manolo', 'Restaurantes y bares', 10, 3, 0], ['La Tagliatella', 'Restaurantes y bares', 32, 1, 0],
  ['Metro de Madrid', 'Transporte', 20, 1, 2], ['Cabify', 'Transporte', 12, 2, 0], ['Repsol', 'Transporte', 45, 1, 0],
  ['Farmacia', 'Salud', 14, 1, 0], ['Zara', 'Ropa', 30, 1, 0], ['Primark', 'Ropa', 15, 1, 0],
  ['IKEA', 'Casa y facturas', 25, 1, 0], ['Cines Yelmo', 'Ocio', 15, 1, 0],
  ['Fnac', 'Ocio', 22, 1, 0], ['Netflix', 'Suscripciones', 13.99, 1, 6], ['Spotify', 'Suscripciones', 11.99, 1, 14],
  ['Amazon', 'Otros', 18, 1, 0],
];

/** Filas [fecha ISO, comercio, importe, categoría] desde hace 5 meses hasta hoy. Sin Apps Script: se puede probar fuera. */
function ejemploFilas_(anio, mes, diaHoy) {
  var semilla = 7;
  var azar = function () { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
  var filas = [];
  for (var m = 5; m >= 0; m--) {
    var a = anio, mm = mes - m;
    while (mm < 0) { mm += 12; a -= 1; }
    var diasMes = new Date(Date.UTC(a, mm + 1, 0)).getUTCDate();
    var tope = m === 0 ? diaHoy : diasMes;
    EJEMPLO.forEach(function (e) {
      for (var v = 0; v < e[3]; v++) {
        if (e[4] === 0 && azar() < 0.15) continue; // algún mes no toca
        var dia = e[4] || 1 + Math.floor(azar() * diasMes);
        if (dia > tope) continue;
        var importe = e[4] ? e[2] : Math.round(e[2] * (0.7 + azar() * 0.6) * 100) / 100;
        var iso = a + '-' + ('0' + (mm + 1)).slice(-2) + '-' + ('0' + dia).slice(-2);
        filas.push([iso, e[0], importe, e[1]]);
      }
    });
  }
  filas.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; });
  return filas;
}

function borrarEjemplo() {
  var h = hoja_('Gastos');
  var n = h.getLastRow() - 1;
  if (n < 1) return;
  // De una vez (borrar fila a fila tardaba más de un minuto).
  var rango = h.getRange(2, 1, n, 6);
  var quedan = rango.getValues().filter(function (f) { return f[4] !== 'Ejemplo'; });
  rango.clearContent();
  if (quedan.length) h.getRange(2, 1, quedan.length, 6).setValues(quedan);
}

// ---------- Utilidades ----------

// En una hoja en español (y en otros idiomas con coma decimal) las fórmulas separan los argumentos con ";", no con ",".
// Las fórmulas de este código se escriben con "," y aquí se adaptan al idioma de tu hoja. Por eso ninguna lleva decimales.
function F_(formula) {
  return separadores_(formula, SpreadsheetApp.getActive().getSpreadsheetLocale());
}

function separadores_(formula, loc) {
  var conComa = /^(es|fr|de|it|pt|nl|ca|gl|eu|pl|ru|tr|sv|da|nb|fi|cs|ro|hu|el)/.test(loc) && loc !== 'es_MX';
  if (!conComa) return formula;
  var r = '', enComillas = false;
  for (var i = 0; i < formula.length; i++) {
    var c = formula[i];
    if (c === '"') enComillas = !enComillas;
    r += (c === ',' && !enComillas) ? ';' : c;
  }
  return r;
}

function hoja_(nombre, crear) {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName(nombre);
  if (!h && crear) h = ss.insertSheet(nombre);
  if (!h) throw new Error('No encuentro la pestaña ' + nombre + '. Usa "Configurar la hoja" en el menú Bot de gastos.');
  return h;
}
