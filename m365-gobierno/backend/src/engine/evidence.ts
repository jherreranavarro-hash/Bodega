import type { GraphLike, RequestOptions } from '../graph/client.js';

/** Registro de un cambio aplicado: cómo estaba el recurso y cómo quedó. */
export interface EvidenceEntry {
  at: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'SCRIPT';
  resource: string;
  api: 'v1.0' | 'beta' | 'powershell';
  /** null = el recurso no existía. */
  before: unknown;
  /** null = eliminado; undefined = no legible después (acciones como /assign). */
  after: unknown;
  request?: unknown;
}

const MAX_JSON = 30_000;
const ACTION = /\/(assign|assignments|\$ref)$/i;

/** Evita guardar objetos gigantes (ej. /deviceManagement completo) en la evidencia. */
export function clip(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const text = JSON.stringify(value);
  if (text.length <= MAX_JSON) return value;
  return { _truncado: true, extracto: text.slice(0, MAX_JSON) };
}

function stripQuery(path: string) {
  return path.split('?')[0];
}

/**
 * Envuelve el cliente de Graph durante un despliegue real: antes de cada escritura lee el
 * recurso (estado anterior) y después lo vuelve a leer (estado posterior). No altera el
 * comportamiento de los playbooks.
 */
export class EvidenceGraph implements GraphLike {
  readonly entries: EvidenceEntry[] = [];

  constructor(private inner: GraphLike) {}

  get<T>(path: string, opts?: RequestOptions) {
    return this.inner.get<T>(path, opts);
  }
  list<T>(path: string, opts?: RequestOptions & { max?: number }) {
    return this.inner.list<T>(path, opts);
  }

  private async read(path: string, opts?: RequestOptions): Promise<unknown> {
    try {
      return await this.inner.get(stripQuery(path), opts);
    } catch (e: any) {
      return e?.status === 404 ? null : { _noLegible: e?.message ?? String(e) };
    }
  }

  private record(e: Omit<EvidenceEntry, 'at' | 'api'>, opts?: RequestOptions) {
    this.entries.push({
      at: new Date().toISOString(),
      api: opts?.beta ? 'beta' : 'v1.0',
      ...e,
      before: clip(e.before),
      after: clip(e.after),
      request: clip(e.request),
    });
  }

  async post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    const res: any = await this.inner.post<T>(path, body, opts);
    if (ACTION.test(stripQuery(path))) {
      this.record({ method: 'POST', resource: stripQuery(path), before: undefined, after: undefined, request: body }, opts);
    } else {
      const resource = res?.id ? `${stripQuery(path)}/${res.id}` : stripQuery(path);
      const after = res?.id ? await this.read(resource, opts) : res;
      this.record({ method: 'POST', resource, before: null, after, request: body }, opts);
    }
    return res;
  }

  private async write<T>(method: 'PATCH' | 'PUT', path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    const before = await this.read(path, opts);
    const res = method === 'PATCH' ? await this.inner.patch<T>(path, body, opts) : await this.inner.put<T>(path, body, opts);
    const after = await this.read(path, opts);
    this.record({ method, resource: stripQuery(path), before, after, request: body }, opts);
    return res;
  }

  patch<T>(path: string, body: unknown, opts?: RequestOptions) {
    return this.write<T>('PATCH', path, body, opts);
  }
  put<T>(path: string, body: unknown, opts?: RequestOptions) {
    return this.write<T>('PUT', path, body, opts);
  }
  async delete(path: string, opts?: RequestOptions) {
    const before = await this.read(path, opts);
    await this.inner.delete(path, opts);
    this.record({ method: 'DELETE', resource: stripQuery(path), before, after: null }, opts);
  }
}
