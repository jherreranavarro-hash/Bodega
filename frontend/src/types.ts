export interface Bodega {
  id: string;
  codigo: string;
  nombre: string;
  ubicaciones: Ubicacion[];
}

export interface Ubicacion {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  bodegaId: string;
}

export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  unidadBaseId: string;
  controlLote: boolean;
  controlSerie: boolean;
  controlVencimiento: boolean;
  metodoValorizacion: string;
  activo: boolean;
  unidadBase?: { codigo: string; nombre: string };
  categoria?: { nombre: string } | null;
  // Campos declarados en la llegada más reciente (Mercado Libre / liquidación), no
  // propios del producto — puede no existir si el producto nunca tuvo una llegada.
  ultimaLlegada?: {
    grupo: string | null;
    condicion: string | null;
    status: string | null;
    subStatus: string | null;
    grade: string | null;
    fechaLlegada: string;
  } | null;
}

export interface UnidadMedida {
  id: string;
  codigo: string;
  nombre: string;
}

export interface Proveedor {
  id: string;
  codigo: string;
  razonSocial: string;
  activo: boolean;
}
