export class ErrorDominio extends Error {
  codigo: string;
  status: number;

  constructor(codigo: string, mensaje: string, status = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

export class ErrorStockInsuficiente extends ErrorDominio {
  constructor(mensaje: string) {
    super("STOCK_INSUFICIENTE", mensaje, 409);
  }
}

export class ErrorValidacion extends ErrorDominio {
  constructor(mensaje: string) {
    super("VALIDACION", mensaje, 400);
  }
}

export class ErrorPermiso extends ErrorDominio {
  constructor(mensaje = "No tiene permiso para esta acción") {
    super("PERMISO_DENEGADO", mensaje, 403);
  }
}

export class ErrorNoEncontrado extends ErrorDominio {
  constructor(mensaje: string) {
    super("NO_ENCONTRADO", mensaje, 404);
  }
}
