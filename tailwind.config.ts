import type { Config } from 'tailwindcss';

/**
 * Config mínima y real: solo lo que la app usa.
 *
 * Igual que en `dassa-control-stock` y `dassa-conciliacion-comprobantes`, no se
 * copia el bloque de tokens `hsl(var(--…))` de los scaffolds de Lovable: esas
 * variables CSS nunca se definen y los colores quedan sin resolver. Acá el rojo
 * institucional va como color concreto.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Rojo DASSA del manual de marca (el mismo #C8202C del manifest).
        dassa: {
          DEFAULT: '#BF1E2E',
          dark: '#A8121E',
          light: '#E0303E',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
