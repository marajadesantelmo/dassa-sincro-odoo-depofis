/**
 * pages/Vendedores.tsx — cómo se traduce el vendedor de Odoo al de DEPOFIS.
 *
 * Es la explicación del criterio del proyecto, en pantalla, para que nadie
 * tenga que abrir el código para entender por qué un cliente salió con el 15.
 *
 * El mapa que se muestra es el de la ÚLTIMA CORRIDA, no una constante del
 * frontend. Es a propósito: si un día el mapa de la rutina cambia y el del
 * frontend no, la pantalla mentiría. Acá siempre muestra lo que la rutina usó
 * de verdad.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Corrida, MapeoVendedor, RespuestaResumen } from '../lib/types';
import { fechaHora } from '../lib/format';
import {
  BannerAlerta, BannerError, BannerInfo, Cargando, Seccion, Tabla, Td, Th, TituloPagina, Vacio,
} from '../components/ui';

export default function Vendedores() {
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<RespuestaResumen>('/api/corridas/resumen')
      .then((r) => setCorrida(r.corrida))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <Cargando />;
  if (error) return <BannerError>{error}</BannerError>;

  const mapa: [string, MapeoVendedor][] = corrida
    ? Object.entries(corrida.vendedor_map).sort((a, b) => a[1].propio - b[1].propio)
    : [];

  return (
    <>
      <TituloPagina
        titulo="Vendedores"
        sub="Cómo se traduce el comercial de Odoo al código de DASSA.Clientes.vendedor"
      />

      <BannerInfo>
        En Odoo el vendedor de un cliente <strong>no está en la pestaña DEPOFIS</strong>: es el
        campo estándar <code className="font-mono">Salesperson</code>, en la pestaña
        “Ventas y compras”. Lo que sí está en la pestaña DEPOFIS es el check{' '}
        <strong>Cliente DASSA</strong>, y es el que decide cuál de los dos códigos del comercial
        se manda:
        <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
          <li><strong>Cliente DASSA destildado</strong> → el código <em>propio</em> del comercial
            (el cliente es de su cartera personal).</li>
          <li><strong>Cliente DASSA tildado</strong> → el código <em>institucional</em>
            (el cliente es de la empresa).</li>
        </ul>
      </BannerInfo>

      <Seccion
        titulo="El mapeo"
        sub={corrida
          ? `Tal como lo usó la corrida #${corrida.id} · ${fechaHora(corrida.iniciada_en)}`
          : undefined}
      >
        {!mapa.length ? (
          <Vacio>
            El mapa se muestra a partir de la primera corrida: la rutina lo publica junto con el
            resultado, así queda registrado cuál se usó cada vez.
          </Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th align="right">uid Odoo</Th>
                <Th>Salesperson</Th>
                <Th align="center">Cliente DASSA destildado</Th>
                <Th align="center">Cliente DASSA tildado</Th>
              </tr>
            </thead>
            <tbody>
              {mapa.map(([uid, v]) => (
                <tr key={uid} className="hover:bg-slate-50">
                  <Td align="right" className="font-mono text-slate-400 tabular-nums">{uid}</Td>
                  <Td className="font-medium">{v.nombre}</Td>
                  <Td align="center" className="font-mono font-bold tabular-nums">{v.propio}</Td>
                  <Td align="center" className="font-mono font-bold tabular-nums text-dassa-dark">{v.institucional}</Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Lo que este mapa no cubre">
        <div className="p-3 space-y-2 text-xs text-slate-600">
          <p>
            <strong>Un contacto sin Salesperson queda sin vendedor.</strong> La rutina deja
            <code className="font-mono mx-1">vendedor</code> en NULL y marca la fila para revisar.
            No cae a un valor por defecto: el <code className="font-mono">0</code> de DEPOFIS
            <em> no</em> significa “sin vendedor” — es un código real, con más de 500 clientes
            asignados. Poner un 0 se leería como un dato bueno.
          </p>
          <p>
            <strong>Hay códigos de DEPOFIS sin usuario en Odoo</strong> (el 1, el 2, el 9 y el 19,
            además del 0). Corresponden a vendedores que no tienen cuenta en Odoo, así que ningún
            contacto puede resolver a esos códigos por esta vía. Los clientes que ya los tienen en
            DEPOFIS los conservan: la rutina no toca clientes existentes.
          </p>
          <p>
            <strong>La rutina no corrige carteras.</strong> Si un cliente cambió de comercial en
            Odoo pero en DEPOFIS sigue con el vendedor viejo, esta rutina no lo actualiza — sólo
            da de alta lo que falta. Reasignar carteras es otro trabajo, y hacerlo en silencio
            desde acá sería peor que no hacerlo.
          </p>
        </div>
      </Seccion>

      <BannerAlerta>
        <strong>De dónde salió este mapa.</strong> No es un criterio inventado: se verificó
        cruzando los 1951 clientes que ya tienen Código DEPOFIS en Odoo contra
        <code className="font-mono mx-1">DASSA.Clientes.vendedor</code>. De los 1369 que además
        tienen un comercial mapeado, el mapa acierta 1360. Las 9 diferencias son clientes cuya
        cartera cambió en Odoo y DEPOFIS todavía no refleja — en todas, el código viejo es el de
        otro comercial, no un segundo código del mismo.
      </BannerAlerta>
    </>
  );
}
