/**
 * server/lib/excel.js — el .xlsx descargable de una corrida.
 *
 * Es el reemplazo del `resultado_sincronizacion.xlsx` que escribía el script
 * original en el disco de quien lo corría. Ahora el archivo lo arma el server
 * desde la misma fuente que ve la pantalla, así que no pueden discrepar.
 *
 * `exceljs` sólo ESCRIBE. Nada de lo que entra a esta app viene de un archivo
 * subido por un usuario, así que acá no hay parser de entrada que blindar.
 */
import ExcelJS from 'exceljs';

const ROJO_DASSA = 'FFC8202C';

/** Columnas de la hoja de clientes. El vendedor va desarmado en tres columnas
 *  porque es lo que hay que poder auditar de un vistazo. */
const COLUMNAS_CLIENTE = [
  { header: 'Odoo ID', key: 'odoo_id', width: 10 },
  { header: 'Nombre', key: 'odoo_nombre', width: 42 },
  { header: 'CUIT', key: 'clave', width: 16 },
  { header: 'Acción', key: 'accion', width: 10 },
  { header: 'Nueva', key: 'es_nueva', width: 8 },
  { header: 'Requiere atención', key: 'requiere_atencion', width: 18 },
  { header: 'Salesperson (Odoo)', key: 'vendedor_nombre', width: 24 },
  { header: 'Cliente DASSA', key: 'es_dassa', width: 14 },
  { header: 'Vendedor DEPOFIS', key: 'vendedor_depofis', width: 17 },
  { header: 'Categoría', key: 'categoria', width: 20 },
  { header: 'Cond. IVA', key: 'iva', width: 10 },
  { header: 'clie_nro', key: 'depofis_id', width: 10 },
  { header: 'Motivo', key: 'motivo', width: 60 },
];

const COLUMNAS_CONCEPTO = [
  { header: 'Odoo ID', key: 'odoo_id', width: 10 },
  { header: 'Nombre', key: 'odoo_nombre', width: 52 },
  { header: 'Referencia Interna', key: 'clave', width: 18 },
  { header: 'Acción', key: 'accion', width: 10 },
  { header: 'Nueva', key: 'es_nueva', width: 8 },
  { header: 'Requiere atención', key: 'requiere_atencion', width: 18 },
  { header: 'Unidad de cálculo', key: 'calcula', width: 18 },
  { header: 'Grupo', key: 'grupo', width: 26 },
  { header: 'código', key: 'depofis_id', width: 10 },
  { header: 'Motivo', key: 'motivo', width: 60 },
];

function encabezar(hoja) {
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_DASSA } };
  fila.alignment = { vertical: 'middle' };
  fila.height = 20;
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
}

const si_no = (v) => (v === true ? 'SÍ' : v === false ? 'no' : '');

function filaCliente(n) {
  const p = n.payload || {};
  return {
    odoo_id: n.odoo_id,
    odoo_nombre: n.odoo_nombre,
    clave: n.clave || '',
    accion: n.accion,
    es_nueva: n.es_nueva ? 'NUEVA' : '',
    requiere_atencion: n.requiere_atencion ? 'SÍ' : '',
    vendedor_nombre: n.vendedor_nombre || '(sin Salesperson)',
    es_dassa: si_no(n.es_dassa),
    // Se escribe el string vacío y no un 0: un vendedor sin resolver no es el
    // vendedor cero, que en DEPOFIS es un código real (523 clientes).
    vendedor_depofis: n.vendedor_depofis == null ? '' : n.vendedor_depofis,
    categoria: p.tipo_cl || '',
    iva: p.iva == null ? '' : p.iva,
    depofis_id: n.depofis_id || '',
    motivo: n.motivo || '',
  };
}

function filaConcepto(n) {
  const p = n.payload || {};
  return {
    odoo_id: n.odoo_id,
    odoo_nombre: n.odoo_nombre,
    clave: n.clave || '',
    accion: n.accion,
    es_nueva: n.es_nueva ? 'NUEVA' : '',
    requiere_atencion: n.requiere_atencion ? 'SÍ' : '',
    calcula: p.calcula || '',
    grupo: p.grupo || '',
    depofis_id: n.depofis_id || '',
    motivo: n.motivo || '',
  };
}

/** Portada: qué corrida es esta y en qué modo corrió. Sin esto, un .xlsx
 *  suelto en un mail no dice si lo que muestra ya se escribió en DEPOFIS. */
function hojaResumen(libro, corrida) {
  const hoja = libro.addWorksheet('Corrida');
  hoja.columns = [{ width: 26 }, { width: 60 }];

  const filas = [
    ['Corrida', `#${corrida.id}`],
    ['Modo', corrida.modo === 'aplicacion'
      ? 'APLICACIÓN — estas altas SÍ se escribieron en DEPOFIS'
      : 'SIMULACIÓN — no se escribió nada en DEPOFIS'],
    ['Estado', corrida.estado],
    ['Origen', corrida.origen],
    ['Disparada por', corrida.disparada_por || '(automática)'],
    ['Inicio', corrida.iniciada_en],
    ['Fin', corrida.terminada_en],
    ['Odoo', corrida.odoo_db || ''],
    ['DEPOFIS leído de', corrida.fuente === 'espejo'
      ? `espejo (${corrida.depofis_server || 'depofis_mirror'})`
      : `origen (${corrida.depofis_server || 'SQL Server'})`],
    ['Espejo actualizado al', corrida.fuente_sincronizada_en || '—'],
    [],
    ['Evaluados', corrida.evaluados],
    ['Altas', corrida.altas],
    ['  · clientes', corrida.altas_clientes],
    ['  · conceptos', corrida.altas_conceptos],
    ['Omitidos', corrida.omitidos],
    ['Errores', corrida.errores],
    ['Requieren atención', corrida.requieren_atencion],
    ['Altas sin vendedor resuelto', corrida.altas_sin_vendedor],
  ];
  for (const f of filas) hoja.addRow(f);

  hoja.getColumn(1).font = { bold: true, size: 10 };
  hoja.getRow(2).font = { bold: true, color: { argb: corrida.modo === 'aplicacion' ? ROJO_DASSA : 'FF1D4ED8' } };
  return hoja;
}

export async function armarLibro({ corrida, novedades }) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sincro Odoo → DEPOFIS · DASSA';
  libro.created = new Date();

  hojaResumen(libro, corrida);

  const clientes = novedades.filter((n) => n.tipo === 'cliente');
  const conceptos = novedades.filter((n) => n.tipo === 'concepto');

  const hojaC = libro.addWorksheet('Clientes');
  hojaC.columns = COLUMNAS_CLIENTE;
  clientes.forEach((n) => hojaC.addRow(filaCliente(n)));
  encabezar(hojaC);

  const hojaK = libro.addWorksheet('Conceptos');
  hojaK.columns = COLUMNAS_CONCEPTO;
  conceptos.forEach((n) => hojaK.addRow(filaConcepto(n)));
  encabezar(hojaK);

  // El mapeo usado va en el libro: sin él, la columna "Vendedor DEPOFIS" es un
  // número sin explicación para quien abra el archivo en otra máquina.
  const hojaV = libro.addWorksheet('Mapeo vendedores');
  hojaV.columns = [
    { header: 'uid Odoo', key: 'uid', width: 10 },
    { header: 'Salesperson', key: 'nombre', width: 28 },
    { header: 'Código propio (Cliente DASSA = no)', key: 'propio', width: 32 },
    { header: 'Código institucional (Cliente DASSA = sí)', key: 'institucional', width: 38 },
  ];
  for (const [uid, v] of Object.entries(corrida.vendedor_map || {})) {
    hojaV.addRow({ uid: Number(uid), nombre: v.nombre, propio: v.propio, institucional: v.institucional });
  }
  encabezar(hojaV);

  return libro.xlsx.writeBuffer();
}

export function nombreArchivo(corrida) {
  const fecha = new Date(corrida.iniciada_en).toISOString().slice(0, 10);
  return `Sincro Odoo-DEPOFIS ${fecha} corrida ${corrida.id} (${corrida.modo}).xlsx`;
}
