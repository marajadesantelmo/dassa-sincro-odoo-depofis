/**
 * pages/Ayuda.tsx — qué hace la rutina y qué significa cada cosa.
 *
 * Escrita para que alguien que abre la app sin contexto entienda, sin
 * preguntar: (1) en qué dirección va la sincronización y que DEPOFIS no se
 * toca, (2) qué es cada marca, (3) qué hacer cuando ve una fila marcada.
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
        <strong>DEPOFIS → Odoo.</strong> Lo que se da de alta en DEPOFIS tiene que existir en Odoo.
        La rutina lee DEPOFIS —sólo lee: no tiene forma de escribirle— y crea o completa lo que
        falta en Odoo. Mientras la escritura no esté habilitada corre en simulación y publica
        acá lo que <em>haría</em>.
      </BannerInfo>

      <Seccion titulo="Qué compara">
        <div className="p-3 text-xs space-y-3 text-slate-600">
          <div>
            <p className="font-bold text-slate-700">Clientes · DASSA.Clientes → res.partner</p>
            <p className="mt-1">
              Mira los clientes <strong>activos</strong> de DEPOFIS y los busca en Odoo, primero por
              Código DEPOFIS y después por CUIT:
            </p>
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li>Si ya hay un contacto con ese Código DEPOFIS, no se toca nada.</li>
              <li>Si no existe en Odoo, se <strong>da de alta</strong> con nombre, CUIT, condición
                de IVA, dirección, email, Código DEPOFIS, el Salesperson y el check Cliente DASSA.</li>
              <li>Si existe un contacto con el mismo CUIT pero sin Código DEPOFIS, se lo
                <strong> vincula</strong>: se le carga el código y se completan sólo los datos que
                tenga vacíos. Lo que alguien cargó a mano no se pisa.</li>
            </ul>
            <p className="mt-1">
              El <strong>Salesperson</strong> sale del vendedor de DEPOFIS: cada comercial tiene un
              código propio y uno institucional (Cliente DASSA). El detalle está en la pantalla{' '}
              <strong>Vendedores</strong>.
            </p>
          </div>
          <div>
            <p className="font-bold text-slate-700">Conceptos · DASSA.Concepfc → product.template</p>
            <p className="mt-1">
              El código de DEPOFIS es la <em>Referencia Interna</em> del producto en Odoo. Los
              conceptos que no estén se dan de alta como servicio de venta con IVA 21%, en la
              categoría que corresponde a su grupo — igual que los que ya están. Las filas de
              Concepfc que no son conceptos (separadores, “NO USAR”, la fila de prueba 999999)
              quedan afuera.
            </p>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Qué significa cada marca">
        <div className="p-3 text-xs">
          <Fila que="ALTA" dice="No existe en Odoo: se crea. En simulación es lo que se crearía; en aplicación, con ✓, lo que se creó." />
          <Fila que="VINCULAR" dice="Existe en Odoo con el mismo CUIT pero sin Código DEPOFIS: se le carga el código y se completan los datos vacíos." />
          <Fila que="No se pueden" dice="Registros de DEPOFIS que no se pueden sincronizar solos. El motivo dice qué corregir: CUIT inválido, CUIT ya vinculado a otro código, contacto duplicado o archivado en Odoo." />
          <Fila que="ERROR" dice="Se intentó escribir en Odoo y lo rechazó. Sólo aparece en corridas de aplicación." />
          <Fila que="NO ES CONCEPTO" dice="Una fila de Concepfc que no es un concepto. No es trabajo pendiente; se ve sólo con su filtro." />
          <Fila que="✓" dice="La escritura en Odoo se hizo y se verificó releyendo el registro." />
          <Fila que="NUEVA" dice="Este registro no figuraba en la corrida anterior." />
          <Fila que="⚠ Atención" dice="Alguien tiene que hacer algo: un alta sin Salesperson, o un registro que no se puede sincronizar." />
          <Fila que="sin Salesperson" dice="El vendedor de DEPOFIS (0, 1, 2, 9 o 19) no tiene usuario en Odoo. El cliente se da de alta igual; el Salesperson se asigna a mano en Odoo." />
        </div>
      </Seccion>

      <Seccion titulo="Cómo corre la rutina">
        <div className="p-3 text-xs space-y-2 text-slate-600">
          <p>
            La rutina es un programa aparte (<code className="font-mono">sincronizar.py</code>),
            no un botón de esta app. Esta app es la ventana: muestra lo que la rutina publica y no
            puede dispararla.
          </p>
          <p className="font-semibold text-slate-700">Cómo se habilita la escritura en Odoo</p>
          <p>
            Hacen falta <strong>dos</strong> cosas, no una: el flag{' '}
            <code className="font-mono">--aplicar</code> al correr la rutina, <em>y</em> la
            variable <code className="font-mono">SINCRO_PERMITIR_APLICAR=si</code> en el{' '}
            <code className="font-mono">.env</code> del servidor. Con una sola, la corrida va en
            simulación igual y lo avisa. Además, la rutina sólo puede crear contactos y productos,
            y en los contactos existentes sólo puede escribir el Código DEPOFIS y completar datos
            vacíos: nunca borra ni cambia nombre o CUIT.
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
