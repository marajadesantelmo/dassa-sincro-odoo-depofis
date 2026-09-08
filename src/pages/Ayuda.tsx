/**
 * pages/Ayuda.tsx — qué hace la rutina y qué significa cada cosa.
 *
 * Escrita para que alguien que abre la app sin contexto entienda, sin
 * preguntar: (1) que hoy no se escribe nada, (2) qué es cada columna, (3) qué
 * tiene que hacer él cuando ve una fila marcada.
 */
import { BannerInfo, Seccion, TituloPagina } from '../components/ui';

function Fila({ que, dice }: { que: string; dice: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <div className="font-semibold text-slate-700">{que}</div>
      <div className="text-slate-600">{dice}</div>
    </div>
  );
}

export default function Ayuda() {
  return (
    <>
      <TituloPagina titulo="Ayuda" sub="Qué hace la rutina, qué mira esta pantalla y qué hacer con lo que muestra" />

      <BannerInfo>
        <strong>Hoy la rutina no escribe nada en DEPOFIS.</strong> Corre en modo simulación:
        compara Odoo contra DEPOFIS y publica acá lo que <em>haría</em>. Habilitar la escritura
        es una decisión aparte, y necesita dos cambios deliberados en el servidor (ver
        “Cómo se habilita”, abajo).
      </BannerInfo>

      <Seccion titulo="Qué compara">
        <div className="p-3 text-xs space-y-3 text-slate-600">
          <div>
            <p className="font-bold text-slate-700">Clientes · res.partner → DASSA.Clientes</p>
            <p className="mt-1">
              Mira las empresas de Odoo que tienen CUIT cargado y todavía no tienen Código
              DEPOFIS. De ésas, propone dar de alta las que además tengan una etiqueta que
              corresponda a una categoría comercial de DEPOFIS.
            </p>
            <p className="mt-1">
              <strong>Sólo clientes.</strong> En Odoo los proveedores viven en la misma tabla
              que los clientes; en DEPOFIS no, van a <code className="font-mono">DASSA.Proveed</code>,
              que esta rutina no toca — ese maestro se administra en Odoo y no necesita estar
              espejado. Un contacto queda <strong>fuera de alcance</strong> cuando hay
              evidencia de que es proveedor —facturas de compra y ninguna de venta, o el CUIT
              en <code className="font-mono">DASSA.Proveed</code>— y ninguna de que sea
              cliente: estar ya en <code className="font-mono">DASSA.Clientes</code>, tener
              facturas de venta, un <em>Salesperson</em>, el check <em>Cliente DASSA</em> o una
              categoría comercial. No se cuentan como pendientes, pero se pueden ver con el
              filtro <em>Proveedores</em> — cada fila explica por qué quedó afuera.
            </p>
            <p className="mt-1">
              El <strong>vendedor</strong> se arma con dos campos de Odoo: el{' '}
              <em>Salesperson</em> y el check <em>Cliente DASSA</em> de la pestaña DEPOFIS.
              El detalle está en la pantalla <strong>Vendedores</strong>.
            </p>
          </div>
          <div>
            <p className="font-bold text-slate-700">Conceptos · product.template → DASSA.Concepfc</p>
            <p className="mt-1">
              Mira los productos con <em>Referencia Interna</em> numérica cuyo código todavía no
              exista en Concepfc. La unidad de cálculo se deriva del nombre, con la misma regla
              que ya usa la prefacturación en producción: si dice “Almacenaje” y “Contenedor”,
              se cobra por días; si dice “Almacenaje” sin “Contenedor”, por días × volumen.
            </p>
            <p className="mt-1">
              <strong>Sin sub-conceptos.</strong> Una Referencia Interna con la forma{' '}
              <code className="font-mono">padre-sufijo</code>{' '}
              (<code className="font-mono">30055-30</code>) no es un concepto: es el tramo de
              días del concepto <code className="font-mono">30055</code>, una apertura que existe
              en Odoo y no en DEPOFIS, donde el concepto es uno solo y los días los resuelve el
              cálculo. Quedan <strong>fuera de alcance</strong> y se ven con el filtro{' '}
              <em>Sub-conceptos</em>.
            </p>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Qué significa cada marca">
        <div className="p-3 text-xs">
          <Fila que="ALTA" dice="Falta en DEPOFIS y hay datos suficientes para crearlo. En simulación es lo que se crearía; en aplicación, lo que se creó." />
          <Fila que="OMITIDO" dice="No corresponde crearlo. El motivo dice por qué: el CUIT ya existe, le falta la categoría, el código ya está en Concepfc." />
          <Fila que="ERROR" dice="Se intentó el alta y DEPOFIS la rechazó. Sólo aparece en corridas de aplicación." />
          <Fila que="PROVEEDOR" dice="No es un cliente: es un proveedor, y los proveedores no se sincronizan. No es trabajo pendiente. Aparece sólo con el filtro Proveedores, para poder revisar el criterio." />
          <Fila que="SUB-CONCEPTO" dice="No es un concepto: es un tramo de días de otro concepto (30055-30 es el tramo de 30055). No se sincroniza ni es trabajo pendiente. Aparece sólo con el filtro Sub-conceptos." />
          <Fila que="NUEVA" dice="Este registro no figuraba en la corrida anterior. Es lo que apareció desde la última vez que se miró." />
          <Fila que="⚠ Atención" dice="Alguien tiene que hacer algo antes de habilitar el alta: falta el vendedor, hay que vincular el Código DEPOFIS en Odoo, o hay un dato que se resolvió por aproximación." />
          <Fila que="sin resolver" dice="El contacto no tiene Salesperson en Odoo, así que no hay código de vendedor que mandar. Se arregla en Odoo, no acá." />
        </div>
      </Seccion>

      <Seccion titulo="Qué hacer con lo que ves">
        <div className="p-3 text-xs space-y-2 text-slate-600">
          <p>
            <strong>“El CUIT ya existe en DEPOFIS”</strong> — el cliente está cargado de los dos
            lados pero no están vinculados. Hay que poner el Código DEPOFIS en la ficha del
            contacto en Odoo. Mientras no se haga, va a aparecer en todas las corridas.
          </p>
          <p>
            <strong>“Sin etiqueta que corresponda a una categoría de DEPOFIS”</strong> — hay que
            ponerle en Odoo una etiqueta cuyo nombre coincida con una categoría comercial que
            DEPOFIS ya use. La categoría es obligatoria para el alta.
          </p>
          <p>
            <strong>“sin resolver” en Vendedor DEPOFIS</strong> — hay que asignarle el Salesperson
            en Odoo. Si no, el cliente se daría de alta sin vendedor, y después habría que
            corregirlo a mano en DEPOFIS.
          </p>
        </div>
      </Seccion>

      <Seccion titulo="Cómo corre la rutina">
        <div className="p-3 text-xs space-y-2 text-slate-600">
          <p>
            La rutina es un programa aparte (<code className="font-mono">sincronizar.py</code>),
            no un botón de esta app. Esta app es la ventana: muestra lo que la rutina publica y no
            puede dispararla. Es deliberado — mientras el proyecto esté en evaluación, disparar la
            sincronización tiene que ser una acción del servidor y no un click.
          </p>
          <p className="font-semibold text-slate-700">Cómo se habilita la escritura</p>
          <p>
            Hacen falta <strong>dos</strong> cosas, no una: el flag{' '}
            <code className="font-mono">--aplicar</code> al correr la rutina, <em>y</em> la
            variable <code className="font-mono">SINCRO_PERMITIR_APLICAR=si</code> en el{' '}
            <code className="font-mono">.env</code> del servidor. Con una sola, la corrida va en
            simulación igual y lo avisa. Están separadas para que un flag copiado de un ejemplo, o
            una línea de cron vieja, no puedan escribir en DEPOFIS por accidente.
          </p>
        </div>
      </Seccion>

      <Seccion titulo="Quién ve esto">
        <div className="p-3 text-xs text-slate-600">
          <p>
            App de acceso restringido: sólo Facundo, Santiago y Manuel. Lo que lo hace cumplir no
            es una lista en un archivo sino la tabla de accesos del IdP — sin acceso otorgado, la
            app no le aparece a nadie, ni a un superadmin. Para sumar o sacar a alguien hay que
            pedírselo a Sistemas.
          </p>
        </div>
      </Seccion>
    </>
  );
}
