import { config } from './config.js';
import { createApp } from './app.js';
import { ensurePassword } from './auth.js';
import { activeEnvironment } from './environments.js';
import { redirectUri } from './auth/delegated.js';

const generated = ensurePassword();
createApp().listen(config.port, config.host, () => {
  console.log(`Gobierno M365 escuchando en ${config.publicUrl} (${config.host}:${config.port})`);
  console.log(`Ambiente activo: ${activeEnvironment().name}`);
  console.log(`Redirect URI para el registro de aplicación: ${redirectUri()}`);
  if (generated) console.log(`APP_PASSWORD no configurada. Contraseña temporal de esta sesión: ${generated}`);
});
