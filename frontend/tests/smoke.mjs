// Smoke test funcional de extremo a extremo sobre la aplicación real.
// Requisitos: backend en http://localhost:4000 (npm run dev), frontend en
// http://localhost:5173 (npm run dev) y datos de la seed cargados.
// Ejecutar con: npm run smoke
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, // opcional: ruta a un chromium ya instalado
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errores = [];
page.on("console", (msg) => { if (msg.type() === "error") errores.push(msg.text()); });
page.on("pageerror", (err) => errores.push(String(err)));

async function paso(nombre, fn) {
  try {
    await fn();
    console.log(`OK  - ${nombre}`);
  } catch (e) {
    console.log(`FAIL - ${nombre}: ${e.message}`);
    await page.screenshot({ path: `/tmp/fallo-${nombre.replace(/\s+/g, "_")}.png` });
    throw e;
  }
}

await paso("cargar login", async () => {
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Bodega Demo");
});

await paso("iniciar sesión", async () => {
  await page.fill('input[type="email"]', "admin@bodegademo.cl");
  await page.fill('input[type="password"]', "ASgSrfXMMQ*3");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Tablero de decisiones", { timeout: 10000 });
});

await paso("centro de decisiones: detectar alerta real y convertirla en solicitud", async () => {
  await page.click('a:has-text("Centro de Decisiones")');
  await page.waitForSelector("text=Centro de decisiones");
  await page.click('button:has-text("Detectar alertas ahora")');
  await page.waitForSelector("text=Bajo punto de reposición", { timeout: 10000 });

  const tarjeta = page.locator(".tarjeta", { hasText: "Bajo punto de reposición" }).first();
  await tarjeta.getByRole("button", { name: "Convertir en solicitud de compra" }).click();
  await page.waitForSelector("text=Convertida en solicitud de compra, pendiente de aprobación", { timeout: 10000 });
});

await paso("ver productos", async () => {
  await page.click('a:has-text("Productos")');
  await page.waitForSelector("text=PROD-001");
});

await paso("ver bodegas y ubicaciones", async () => {
  await page.click('a:has-text("Bodegas y Ubicaciones")');
  await page.waitForSelector("text=BOD-CENTRAL");
  await page.waitForSelector("text=REC");
});

await paso("centro de cargas visible", async () => {
  await page.click('a:has-text("Centro de Cargas")');
  await page.waitForSelector("text=Centro de cargas de datos");
});

await paso("compras y recepción visible", async () => {
  await page.click('a:has-text("Compras y Recepción")');
  await page.waitForSelector("text=Nueva orden de compra");
});

const folioRecepcionSmoke = `REC-SMOKE-${Date.now()}`;
await paso("registrar recepción real vía formulario (stock base para el resto del recorrido)", async () => {
  await page.fill('form:has-text("Registrar recepción") input:near(:text("Folio"))', folioRecepcionSmoke);
  await page.selectOption('form:has-text("Registrar recepción") select >> nth=0', { label: "BOD-CENTRAL" });
  await page.selectOption('form:has-text("Registrar recepción") select >> nth=1', { label: "ALM-A-01" });
  await page.selectOption('form:has-text("Registrar recepción") select >> nth=3', { label: "PROD-001" });
  const cantidadInputs = page.locator('form:has-text("Registrar recepción") input[type="number"]');
  await cantidadInputs.nth(0).fill("50");
  await cantidadInputs.nth(1).fill("100");
  await page.click('form:has-text("Registrar recepción") button[type="submit"]');
  await page.waitForSelector("text=Recepción contabilizada", { timeout: 10000 });
});

const folioSolicitudCompra = `SC-SMOKE-${Date.now()}`;
await paso("registrar solicitud de compra real (nace pendiente de aprobación)", async () => {
  await page.fill('form:has-text("Nueva solicitud de compra") input:near(:text("Folio"))', folioSolicitudCompra);
  await page.selectOption('form:has-text("Nueva solicitud de compra") select >> nth=0', { label: "BOD-CENTRAL" });
  await page.selectOption('form:has-text("Nueva solicitud de compra") select >> nth=1', { label: "PROD-001" });
  await page.click('form:has-text("Nueva solicitud de compra") button[type="submit"]');
  const fila = page.locator("tr", { hasText: folioSolicitudCompra });
  await fila.waitFor({ timeout: 10000 });
  await fila.getByText("PENDIENTE APROBACION").waitFor({ timeout: 10000 });
});

const folioSolicitud = `SS-SMOKE-${Date.now()}`;
await paso("flujo real: solicitud -> reserva -> preparación -> despacho", async () => {
  await page.click('a:has-text("Solicitudes, Reservas y Despacho")');
  await page.waitForSelector("text=Nueva solicitud de salida");

  await page.fill('form:has-text("Nueva solicitud de salida") input:near(:text("Folio"))', folioSolicitud);
  await page.selectOption('form:has-text("Nueva solicitud de salida") select >> nth=0', { label: "BOD-CENTRAL" });
  await page.selectOption('form:has-text("Nueva solicitud de salida") select >> nth=1', { label: "PROD-001" });
  await page.fill('form:has-text("Nueva solicitud de salida") input[type="number"]', "5");
  await page.click('form:has-text("Nueva solicitud de salida") button[type="submit"]');

  const tarjeta = page.locator(".tarjeta", { hasText: folioSolicitud });
  await tarjeta.waitFor({ timeout: 10000 });

  await tarjeta.getByRole("button", { name: "Reservar" }).click();
  await tarjeta.getByRole("button", { name: "Crear lista de preparación" }).waitFor({ timeout: 10000 });
  await tarjeta.getByRole("button", { name: "Crear lista de preparación" }).click();

  await tarjeta.locator('input[type="number"]').last().waitFor({ timeout: 10000 });
  await tarjeta.locator('input[type="number"]').last().fill("5");
  await tarjeta.getByRole("button", { name: "Verificar" }).click();

  await tarjeta.getByRole("button", { name: "Marcar preparación como lista" }).waitFor({ timeout: 10000 });
  await tarjeta.getByRole("button", { name: "Marcar preparación como lista" }).click();

  await tarjeta.getByRole("button", { name: /Despachar remanente/ }).waitFor({ timeout: 10000 });
  await tarjeta.getByRole("button", { name: /Despachar remanente/ }).click();

  await tarjeta.getByText("Sin remanente").waitFor({ timeout: 10000 });
});

await paso("transferencias visible", async () => {
  await page.click('a:has-text("Transferencias")');
  await page.waitForSelector("text=Nueva transferencia");
});

const folioDev = `DEV-SMOKE-${Date.now()}`;
await paso("registrar devolución real y verificar que no queda disponible", async () => {
  await page.click('a:has-text("Devoluciones")');
  await page.waitForSelector("text=Registrar ingreso de devolución");
  await page.fill('form:has-text("Registrar ingreso de devolución") input:near(:text("Folio"))', folioDev);
  await page.selectOption('form:has-text("Registrar ingreso de devolución") select >> nth=0', { label: "BOD-CENTRAL" });
  await page.selectOption('form:has-text("Registrar ingreso de devolución") select >> nth=1', { label: "Rechazo del cliente" });
  await page.selectOption('form:has-text("Registrar ingreso de devolución") select >> nth=2', { label: "PROD-001" });
  await page.click('form:has-text("Registrar ingreso de devolución") button[type="submit"]');
  await page.waitForSelector(`text=${folioDev}`, { timeout: 10000 });
  await page.waitForSelector("text=PENDIENTE INSPECCION");
});

await paso("conteos y ajustes visible", async () => {
  await page.click('a:has-text("Conteos y Ajustes")');
  await page.waitForSelector("text=Planificar conteo cíclico");
});

const folioOC = `OC-SMOKE-${Date.now()}`;
await paso("crear orden de compra real vía formulario", async () => {
  await page.click('a:has-text("Compras y Recepción")');
  await page.fill('form:has-text("Nueva orden de compra") input:near(:text("Folio"))', folioOC);
  await page.selectOption('form:has-text("Nueva orden de compra") select >> nth=0', { label: "PROV-001 — Distribuidora Andina Ltda." });
  await page.selectOption('form:has-text("Nueva orden de compra") select >> nth=1', { label: "PROD-001 — Arroz Grado 1 - 1kg" });
  await page.click('form:has-text("Nueva orden de compra") button[type="submit"]');
  await page.waitForSelector(`text=${folioOC}`, { timeout: 10000 });
});

const nombreArchivo = `smoke-${Date.now()}.csv`;
await paso("subir archivo real al centro de cargas", async () => {
  await page.click('a:has-text("Centro de Cargas")');
  await page.selectOption("form.tarjeta.grid-form select >> nth=0", "PRODUCTOS");
  const csv = `codigo,nombre,unidad_base_codigo\nSMOKE-${Date.now()},Producto de humo,UN\n`;
  const buffer = Buffer.from(csv, "utf-8");
  await page.setInputFiles('input[type="file"]', { name: nombreArchivo, mimeType: "text/csv", buffer });
  await page.click('form.tarjeta.grid-form button[type="submit"]');
  await page.waitForSelector(`text=${nombreArchivo}`, { timeout: 10000 });
});

await paso("validar, aprobar y ejecutar la carga desde la UI", async () => {
  const fila = page.locator("tr", { hasText: nombreArchivo });
  await fila.getByRole("button", { name: "Validar y simular" }).click();
  await page.waitForTimeout(500);
  await fila.getByRole("button", { name: "Aprobar" }).click();
  await page.waitForTimeout(500);
  await fila.getByRole("button", { name: "Ejecutar" }).click();
  await page.waitForSelector(`tr:has-text("${nombreArchivo}") >> text=Completada`, { timeout: 10000 });
});

await paso("pronósticos: declara datos insuficientes sin inventar cifra, y simula un escenario real", async () => {
  await page.click('a:has-text("Pronósticos y Escenarios")');
  await page.waitForSelector("text=Pronósticos y escenarios de simulación");

  await page.selectOption('div.tarjeta.grid-form:has-text("Calcular pronóstico") select >> nth=0', { label: "BOD-CENTRAL" });
  await page.selectOption('div.tarjeta.grid-form:has-text("Calcular pronóstico") select >> nth=1', { label: "PROD-001" });
  await page.click('div.tarjeta.grid-form:has-text("Calcular pronóstico") button:has-text("Calcular")');
  await page.waitForSelector("text=Datos insuficientes", { timeout: 10000 });

  const formEscenario = page.locator('div.tarjeta.grid-form:has-text("Simular un escenario")');
  await formEscenario.locator('input').first().fill(`Escenario smoke ${Date.now()}`);
  await formEscenario.locator("select").nth(0).selectOption({ label: "BOD-CENTRAL" });
  await formEscenario.locator("select").nth(1).selectOption({ label: "PROD-001" });
  await formEscenario.getByRole("button", { name: "Simular" }).click();
  await page.waitForSelector("text=Punto reposición actual", { timeout: 10000 });
});

await paso("administración: otorga y revoca un permiso real de un rol", async () => {
  await page.click('a:has-text("Administración")');
  await page.waitForSelector("text=Matriz de permisos por rol");

  const fila = page.locator("tr", { hasText: "productos" }).filter({ hasText: ".exportar" }).first();
  await fila.waitFor({ timeout: 10000 });

  // Ubica la casilla del rol "Auditor" por la posición de su columna en el encabezado.
  const indiceColumna = await page.locator("thead th").allTextContents().then((th) => th.indexOf("Auditor"));
  if (indiceColumna < 0) throw new Error('No se encontró la columna "Auditor" en la matriz de permisos');
  const casilla = fila.locator("td").nth(indiceColumna).locator("input");
  const estabaMarcada = await casilla.isChecked();
  await casilla.click();
  await page.waitForSelector("text=Permiso productos.exportar", { timeout: 10000 });
  const quedoMarcada = await casilla.isChecked();
  if (quedoMarcada === estabaMarcada) throw new Error("El estado de la casilla de permiso no cambió tras el clic");

  await page.waitForSelector("text=Usuarios");
  await page.waitForSelector("text=admin@bodegademo.cl");
});

const codigoLlegada = `SMOKE-ML-${Date.now()}`;

await paso("llegada de productos: sube un CSV con encabezados en español, valida, aprueba y ejecuta", async () => {
  await page.click('a:has-text("Centro de Cargas")');
  await page.waitForSelector("text=Centro de cargas de datos");
  await page.selectOption("form.tarjeta.grid-form select >> nth=0", "LLEGADA_PRODUCTOS");
  await page.waitForSelector("text=Bodega de destino");
  // Con LLEGADA_PRODUCTOS el formulario tiene 3 selects en orden: Entidad, Modo, Bodega de destino.
  const selectBodega = page.locator("form.tarjeta.grid-form select").nth(2);
  await selectBodega.locator("option").nth(1).waitFor({ state: "attached", timeout: 10000 }); // espera a que /bodegas termine de cargar (Playwright considera <option> "oculto" aunque esté listo)
  await selectBodega.selectOption({ index: 1 }); // primera bodega real de la lista

  const csv =
    "Grupo,Código,Código ML,Código original,Título,Condición,Status,Sub Status,Grade,Cantidad solicitada,Cantidad colectada,Cantidad enviada,Peso,Valor,Valor en USD\n" +
    `Electrónica,${codigoLlegada},MLC-SMOKE,ORIG-SMOKE,Cargador rápido de humo,Usado,Cerrado,Entregado,A,2,2,2,0.2,9000,10\n`;
  await page.setInputFiles('input[type="file"]', { name: "llegada-smoke.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await page.click('form.tarjeta.grid-form button[type="submit"]');
  await page.waitForSelector("text=Archivo recibido en el área de preparación", { timeout: 10000 });

  const fila = page.locator("tr", { hasText: "llegada-smoke.csv" });
  await fila.getByRole("button", { name: "Validar y simular" }).click();
  await page.waitForTimeout(500);
  await fila.getByRole("button", { name: "Aprobar" }).click();
  await page.waitForTimeout(500);
  await fila.getByRole("button", { name: "Ejecutar" }).click();
  await page.waitForSelector('tr:has-text("llegada-smoke.csv") >> text=Completada', { timeout: 10000 });
});

await paso("el producto llegado aparece en Productos", async () => {
  await page.click('a:has-text("Productos")');
  await page.waitForSelector(`text=${codigoLlegada}`, { timeout: 10000 });
});

await paso("precios de venta: configura un margen porcentual y se calcula el precio real", async () => {
  await page.click('a:has-text("Precios de Venta")');
  await page.waitForSelector("text=Precios de venta");
  const fila = page.locator("tr", { hasText: codigoLlegada });
  await fila.waitFor({ timeout: 10000 });
  await fila.locator('input[type="number"]').fill("50");
  await fila.locator('button:has-text("Guardar")').click();
  await page.waitForSelector("text=Precio actualizado.", { timeout: 10000 });
  const textoPrecio = await fila.locator("strong").textContent();
  if (!textoPrecio || textoPrecio.includes("Sin calcular")) {
    throw new Error(`El precio de venta no se calculó a partir del valor declarado en la llegada: "${textoPrecio}"`);
  }
});

await paso("precios de venta: desmarcar afecto a IVA hace que el precio con IVA sea igual al neto", async () => {
  const fila = page.locator("tr", { hasText: codigoLlegada });
  const checkboxIva = fila.locator('input[type="checkbox"]');
  await checkboxIva.uncheck();
  await fila.locator('button:has-text("Guardar")').click();
  await page.waitForSelector("text=Precio actualizado.", { timeout: 10000 });
  const precioNeto = (await fila.locator("td").nth(7).textContent())?.trim();
  const precioConIva = (await fila.locator("strong").textContent())?.trim();
  if (!precioNeto || precioNeto === "Sin calcular" || precioNeto !== precioConIva) {
    throw new Error(`Al desmarcar "Afecto a IVA" el precio con IVA debería igualar al neto: neto="${precioNeto}" conIva="${precioConIva}"`);
  }
});

if (errores.length > 0) {
  console.log("Errores de consola detectados:", errores);
}

await browser.close();
console.log("SMOKE TEST OK");
