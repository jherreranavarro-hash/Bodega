import express from "express";
import cors from "cors";
import "./modules/cargas/carga.service.js"; // registra los manejadores de importación
import { authRouter } from "./modules/auth/auth.routes.js";
import { productosRouter } from "./modules/productos/productos.routes.js";
import { bodegasRouter, ubicacionesRouter } from "./modules/maestros/bodegas.routes.js";
import { proveedoresRouter } from "./modules/maestros/proveedores.routes.js";
import { catalogosRouter } from "./modules/maestros/catalogos.routes.js";
import { cargasRouter } from "./modules/cargas/carga.routes.js";
import { comprasRouter } from "./modules/compras/compras.routes.js";
import { salidasRouter } from "./modules/salidas/salidas.routes.js";
import { preparacionesRouter } from "./modules/preparaciones/preparaciones.routes.js";
import { transferenciasRouter } from "./modules/transferencias/transferencias.routes.js";
import { devolucionesRouter } from "./modules/devoluciones/devoluciones.routes.js";
import { ajustesRouter } from "./modules/ajustes/ajustes.routes.js";
import { indicadoresRouter } from "./modules/indicadores/indicadores.routes.js";

export function crearApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/salud", (_req, res) => res.json({ estado: "ok" }));

  app.use("/api/auth", authRouter);
  app.use("/api/productos", productosRouter);
  app.use("/api/bodegas", bodegasRouter);
  app.use("/api/ubicaciones", ubicacionesRouter);
  app.use("/api/proveedores", proveedoresRouter);
  app.use("/api/catalogos", catalogosRouter);
  app.use("/api/cargas", cargasRouter);
  app.use("/api/compras", comprasRouter);
  app.use("/api/salidas", salidasRouter);
  app.use("/api/preparaciones", preparacionesRouter);
  app.use("/api/transferencias", transferenciasRouter);
  app.use("/api/devoluciones", devolucionesRouter);
  app.use("/api", ajustesRouter);
  app.use("/api/indicadores", indicadoresRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const status = (err as { status?: number })?.status ?? 500;
    res.status(status).json({ error: (err as Error)?.message ?? "Error interno" });
  });

  return app;
}
