/**
 * App.tsx — root del SPA. BrowserRouter con basename "/sincro-odoo-depofis".
 *
 *   /              ← el historial: todo lo sincronizado en Odoo, de todas las corridas
 *   /ultima        ← la última corrida (lo que hizo y lo que no se pudo)
 *   /corridas/:id  ← una corrida puntual (la MISMA pantalla que /ultima)
 *   /corridas      ← la lista de corridas
 *   /vendedores    ← cómo se traduce el vendedor de DEPOFIS al Salesperson de Odoo
 *   /ayuda         ← qué hace la rutina y qué hacer con lo que muestra
 *
 * Una corrida tiene URL propia porque es un registro permanente: tiene que
 * poder mandarse por mail el link de la corrida del martes.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Novedades from './pages/Novedades';
import Sincronizado from './pages/Sincronizado';
import Corridas from './pages/Corridas';
import Vendedores from './pages/Vendedores';
import Ayuda from './pages/Ayuda';

export default function App() {
  return (
    <BrowserRouter basename="/sincro-odoo-depofis">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Sincronizado />} />
          <Route path="/ultima" element={<Novedades />} />
          <Route path="/corridas" element={<Corridas />} />
          <Route path="/corridas/:id" element={<Novedades />} />
          <Route path="/vendedores" element={<Vendedores />} />
          <Route path="/ayuda" element={<Ayuda />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
