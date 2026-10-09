/**
 * lib/types.ts — el shape de lo que devuelve la API.
 *
 * Espeja las vistas `v_corrida_resumen` y `v_novedad` (sql/030_vistas.sql). Si
 * se agrega una columna allá y se quiere en pantalla, se agrega acá.
 */

export interface Me {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  permissions: string[];
}

export type Modo = 'simulacion' | 'aplicacion';
export type EstadoCorrida = 'en_curso' | 'ok' | 'con_errores' | 'fallida';
export type TipoNovedad = 'cliente' | 'concepto';
/** Lo que la rutina hace (o haría) en ODOO con un registro de DEPOFIS:
 *  - `alta`: no existe en Odoo, se crea.
 *  - `vincular`: el cliente existe en Odoo con el mismo CUIT y le falta el
 *    Código DEPOFIS; se le carga y se completan los datos vacíos.
 *  - `omitido`: no se puede (CUIT inválido, duplicado…); el motivo dice por qué.
 *  - `error`: se intentó y Odoo lo rechazó.
 *  - `fuera_alcance`: una fila de Concepfc que no es un concepto (separador,
 *    "NO USAR", la fila de prueba). No es trabajo pendiente. */
export type AccionNovedad = 'alta' | 'vincular' | 'omitido' | 'error' | 'fuera_alcance';

/** Una entrada del VENDEDOR_MAP tal como la guardó la corrida. */
export interface MapeoVendedor {
  nombre: string;
  propio: number;
  institucional: number;
}

export interface Corrida {
  id: number;
  modo: Modo;
  origen: 'cron' | 'cli' | 'manual';
  disparada_por: string | null;
  estado: EstadoCorrida;
  iniciada_en: string;
  terminada_en: string | null;
  duracion_ms: number | null;
  odoo_db: string | null;
  depofis_server: string | null;
  /** De dónde se LEYÓ DEPOFIS. Desde la 0.2 siempre `espejo` (depofis_mirror,
   *  sólo lectura); viene con su frescura y la pantalla la muestra. */
  fuente: 'espejo' | 'origen';
  fuente_sincronizada_en: string | null;
  vendedor_map: Record<string, MapeoVendedor>;
  error: string | null;
  version_rutina: string | null;
  /** Lo que la rutina contó y no publicó fila por fila: lo que NO cambia. */
  totales: Totales;
  /** id de la corrida completada anterior. NULL = ésta es la primera, y por eso
   *  no hay nada marcado como nuevo. */
  anterior_id: number | null;

  evaluados: number;
  clientes: number;
  conceptos: number;
  altas: number;
  altas_clientes: number;
  altas_conceptos: number;
  /** Clientes que existen en Odoo por CUIT y se vinculan. */
  vinculaciones: number;
  /** altas + vinculaciones: lo que se sube o modifica en Odoo. */
  a_sincronizar: number;
  /** Escrituras en Odoo hechas y verificadas. */
  ejecutadas: number;
  omitidos: number;
  errores: number;
  /** Registros descartados por no ser asunto de la rutina. Se cuenta aparte de
   *  `omitidos` a propósito: nada de esto es algo pendiente de resolver. */
  fuera_alcance: number;
  /** En corridas 0.1, los proveedores. Desde la 0.2 siempre 0. */
  fuera_alcance_clientes: number;
  /** Filas de Concepfc que no son conceptos (en corridas 0.1, los sub-conceptos). */
  fuera_alcance_conceptos: number;
  /** `evaluados` menos los `fuera_alcance`. Es el denominador honesto: lo que
   *  la rutina realmente analizó como cliente o concepto. */
  en_alcance: number;
  requieren_atencion: number;
  /** Altas de cliente que entran a Odoo sin Salesperson: su vendedor de
   *  DEPOFIS no tiene usuario en Odoo. */
  altas_sin_vendedor: number;
}

export interface TotalesTipo {
  sin_cambios?: number;
  inactivos?: number;
}

export interface Totales {
  clientes?: TotalesTipo;
  conceptos?: TotalesTipo;
}

/** Lo que se escribe (o escribiría) en Odoo y lo que se leyó de DEPOFIS. */
export interface PayloadNovedad {
  /** Los valores tal como van al create/write de Odoo. */
  odoo?: Record<string, unknown>;
  depofis?: {
    tipo_cl?: string;
    etiqueta?: string | null;
    iva_depofis?: number | null;
    fecha_alta?: string | null;
    grupo?: string;
    gravado?: string;
    importe?: number;
    calcula?: string;
  };
}

export interface Novedad {
  id: number;
  corrida_id: number;
  tipo: TipoNovedad;
  /** Contacto/producto de Odoo: el que se vincula, o el creado. NULL en un alta no ejecutada. */
  odoo_id: number | null;
  /** El nombre que trae DEPOFIS (la columna conserva su nombre histórico). */
  odoo_nombre: string;
  clave: string | null;
  accion: AccionNovedad;
  motivo: string | null;
  requiere_atencion: boolean;

  vendedor_uid: number | null;
  vendedor_nombre: string | null;
  es_dassa: boolean | null;
  vendedor_depofis: number | null;

  payload: PayloadNovedad;
  /** clie_nro o código de concepto: la clave de la fila. */
  depofis_id: string | null;
  ejecutada: boolean;
  es_nueva: boolean;
  anterior_id: number | null;
  creado_en: string;
}

export interface RespuestaResumen {
  corrida: Corrida | null;
  novedades: Novedad[];
}
