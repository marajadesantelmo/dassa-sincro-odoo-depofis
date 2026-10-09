/**
 * pages/Vendedores.tsx — cómo se traduce el vendedor de DEPOFIS al Salesperson de Odoo.
 *
 * Es la explicación del criterio del proyecto, en pantalla, para que nadie
 * tenga que abrir el código para entender por qué un cliente quedó con tal Salesperson.
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
        sub="Cómo se traduce DASSA.Clientes.vendedor al Salesperson y al check Cliente DASSA de Odoo"
      />

      <BannerInfo>
        En Odoo el vendedor de un cliente <strong>no está en la pestaña DEPOFIS</strong>: es el
        campo estándar <code className="font-mono">Salesperson</code>, en la pestaña
        “Ventas y compras”. En DEPOFIS cada comercial tiene <strong>dos códigos</strong>, y el
        código del cliente decide además el check <strong>Cliente DASSA</strong> de la pestaña DEPOFIS:
        <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
          <li><strong>Código propio</strong> → Salesperson = el comercial, Cliente DASSA destildado
            (el cliente es de su cartera personal).</li>
          <li><strong>Código institucional</strong> → Salesperson = el comercial, Cliente DASSA
            tildado (el cliente es de la empresa).</li>
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
                <Th align="center">Código propio</Th>
                <Th align="center">Código institucional (Cliente DASSA)</Th>
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
            <strong>Hay códigos de DEPOFIS sin usuario en Odoo:</strong> el 0 (sin vendedor), el 1,
            el 2, el 9 y el 19. Un cliente con cualquiera de ellos se da de alta en Odoo igual, sin
            Salesperson, y la fila queda marcada para que alguien lo asigne a mano.
          </p>
          <p>
            <strong>La rutina no corrige carteras.</strong> A un cliente que ya está vinculado en Odoo
            no se le toca ningún dato, aunque en DEPOFIS cambie de vendedor. Y al vincular uno que
            existía sin código, el Salesperson se completa sólo si estaba vacío.
          </p>
        </div>
      </Seccion>

      <BannerAlerta>
        <strong>De dónde salió este mapa.</strong> No es un criterio inventado: se verificó
        cruzando los ~1950 clientes que ya tienen Código DEPOFIS en Odoo contra
        <code className="font-mono mx-1">DASSA.Clientes.vendedor</code>, y reproduce el 99,6 % de
        los casos. Las diferencias son clientes cuya cartera cambió en Odoo y DEPOFIS todavía no
        refleja — en todas, el código es el de otro comercial, no un segundo código del mismo.
      </BannerAlerta>
    </>
  );
}
