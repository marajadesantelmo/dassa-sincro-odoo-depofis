/**
 * App.tsx — root del SPA. BrowserRouter con basename "/sincro-odoo-depofis".
 *
 *   /              ← las novedades de la última corrida
 *   /corridas/:id  ← una corrida puntual (la MISMA pantalla)
 *   /corridas      ← el histórico
 *   /vendedores    ← cómo se traduce el vendedor de Odoo al código de DEPOFIS
 *   /ayuda         ← qué hace la rutina y qué hacer con lo que muestra
 *
 * Una corrida tiene URL propia porque es un registro permanente: tiene que
 * poder mandarse por mail el link de la corrida del martes.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Novedades from './pages/Novedades';
import Corridas from './pages/Corridas';
import Vendedores from './pages/Vendedores';
import Ayuda from './pages/Ayuda';

export default function App() {
  return (
    <BrowserRouter basename="/sincro-odoo-depofis">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Novedades />} />
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
