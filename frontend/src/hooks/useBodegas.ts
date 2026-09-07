import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bodega } from "../types";

export function useBodegas() {
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api
      .get<Bodega[]>("/bodegas")
      .then(setBodegas)
      .finally(() => setCargando(false));
  }, []);

  return { bodegas, cargando };
}
