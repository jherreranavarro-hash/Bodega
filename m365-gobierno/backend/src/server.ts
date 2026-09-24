import { config, currentMode } from './config.js';
import { createApp } from './app.js';
import { ensurePassword } from './auth.js';

const generated = ensurePassword();
createApp().listen(config.port, config.host, () => {
  console.log(`Gobierno M365 escuchando en http://${config.host}:${config.port}`);
  console.log(`Modo: ${currentMode() === 'real' ? `REAL (tenant ${config.tenantId})` : 'SIMULACIÓN (sin credenciales o MODO=simulacion)'}`);
  if (generated) console.log(`APP_PASSWORD no configurada. Contraseña temporal de esta sesión: ${generated}`);
});
