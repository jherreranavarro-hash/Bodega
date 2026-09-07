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
  await page.fill('input[type="password"]', "Demo1234!");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Tablero de decisiones", { timeout: 10000 });
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

await paso("solicitudes reservas despacho visible", async () => {
  await page.click('a:has-text("Solicitudes, Reservas y Despacho")');
  await page.waitForSelector("text=Nueva solicitud de salida");
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

if (errores.length > 0) {
  console.log("Errores de consola detectados:", errores);
}

await browser.close();
console.log("SMOKE TEST OK");
