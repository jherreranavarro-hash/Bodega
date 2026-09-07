import "dotenv/config";
import { crearApp } from "./app.js";

const port = process.env.PORT ?? 4000;
crearApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Bodega API escuchando en puerto ${port}`);
});
