// ecosystem.config.cjs — pm2 para la app hija "sincro-odoo-depofis".
//
// 🚨 NUNCA `pm2 restart all` en este VPS: tira toda la producción de DASSA.
// Levantar/recargar SOLO este proceso:  pm2 start ecosystem.config.cjs
//                                       pm2 restart dassa-sincro-odoo-depofis
//
// Los secretos NO se cargan acá: pm2 copia el `env:` al proceso y `ps auxe`
// los deja legibles para cualquier usuario del box. El server lee el .env por
// su cuenta con `dotenv/config` al inicio de server/index.js.
//
// La rutina de sincronización NO va como proceso pm2. Es `sincronizar.py`,
// que corre por cron (o a mano) y publica el resultado por HTTP. Un proceso
// pm2 con `cron_restart` REINICIA la app, no ejecuta una tarea.
module.exports = {
  apps: [{
    name: 'dassa-sincro-odoo-depofis',
    cwd: '/home/dassa/dassa4/apps/sincro-odoo-depofis',
    script: 'server/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3038,
    },
    // exceljs arma el libro entero en memoria. Una corrida son ~500 novedades;
    // el tope deja margen de sobra y corta una fuga antes de que moleste a los
    // vecinos del box.
    max_memory_restart: '300M',
    restart_delay: 3000,
    time: true,
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
  }],
};
