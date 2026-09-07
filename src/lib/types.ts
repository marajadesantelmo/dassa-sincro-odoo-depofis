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
export type AccionNovedad = 'alta' | 'omitido' | 'error';

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
  /** De dónde se LEYÓ DEPOFIS. `espejo` es una copia diaria: por eso viene con
   *  su frescura y la pantalla la muestra. Una corrida de aplicación siempre
   *  es `origen`. */
  fuente: 'espejo' | 'origen';
  fuente_sincronizada_en: string | null;
  vendedor_map: Record<string, MapeoVendedor>;
  error: string | null;
  version_rutina: string | null;
  /** id de la corrida completada anterior. NULL = ésta es la primera, y por eso
   *  no hay nada marcado como nuevo. */
  anterior_id: number | null;

  evaluados: number;
  clientes: number;
  conceptos: number;
  altas: number;
  altas_clientes: number;
  altas_conceptos: number;
  omitidos: number;
  errores: number;
  requieren_atencion: number;
  /** Altas de cliente que quedarían con `vendedor` NULL en DEPOFIS. Es el
   *  número que mide el trabajo pendiente en Odoo. */
  altas_sin_vendedor: number;
}

/** Lo que se escribiría (o escribió) en DEPOFIS. Las claves son las columnas
 *  reales de DASSA.Clientes / DASSA.Concepfc, así que van sin traducir. */
export interface PayloadCliente {
  clie_nro?: number;
  apellido?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  cpostal?: string;
  telefono?: string;
  tipo_cl?: string;
  tipo_doc?: string;
  documento?: string;
  iva?: number;
  vendedor?: number | null;
  consolida?: number;
  email?: string;
  estado?: number;
}

export interface PayloadConcepto {
  codigo?: number;
  detalle?: string;
  calcula?: string;
  grupo?: string;
}

export interface Novedad {
  id: number;
  corrida_id: number;
  tipo: TipoNovedad;
  odoo_id: number;
  odoo_nombre: string;
  clave: string | null;
  accion: AccionNovedad;
  motivo: string | null;
  requiere_atencion: boolean;

  vendedor_uid: number | null;
  vendedor_nombre: string | null;
  es_dassa: boolean | null;
  vendedor_depofis: number | null;

  payload: PayloadCliente & PayloadConcepto;
  depofis_id: string | null;
  es_nueva: boolean;
  anterior_id: number | null;
  creado_en: string;
}

export interface RespuestaResumen {
  corrida: Corrida | null;
  novedades: Novedad[];
}
