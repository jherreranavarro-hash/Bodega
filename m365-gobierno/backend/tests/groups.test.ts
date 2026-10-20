import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { SimulatedGraph as Sim } from '../src/graph/simulated.js';

// config.ts lee DATA_DIR y APP_PASSWORD al importarse: todo módulo del backend se carga después
let G: typeof import('../src/groups.js');
let SimulatedGraph: typeof Sim;
let app: any;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gob-grp-'));
  process.env.APP_PASSWORD = 'clave-de-prueba';
  G = await import('../src/groups.js');
  ({ SimulatedGraph } = await import('../src/graph/simulated.js'));
  const { createApp } = await import('../src/app.js');
  app = createApp();
  token = (await request(app).post('/api/login').send({ password: 'clave-de-prueba' })).body.token;
});

const listSecurityGroups = (...a: Parameters<typeof G.listSecurityGroups>) => G.listSecurityGroups(...a);
const listMembers = (...a: Parameters<typeof G.listMembers>) => G.listMembers(...a);
const parseAccounts = (...a: Parameters<typeof G.parseAccounts>) => G.parseAccounts(...a);
const previewMembership = (...a: Parameters<typeof G.previewMembership>) => G.previewMembership(...a);
const applyMembership = (...a: Parameters<typeof G.applyMembership>) => G.applyMembership(...a);

describe('grupos de seguridad', () => {
  it('lista solo grupos con seguridad, con tipo, conteo y bloqueos', async () => {
    const groups = await listSecurityGroups(new SimulatedGraph());
    const by = Object.fromEntries(groups.map((g) => [g.id, g]));
    expect(by['g-dl']).toBeUndefined(); // lista de distribución: no es de seguridad
    expect(by['g-fin']).toMatchObject({ kind: 'asignado', members: 6, editable: true });
    expect(by['g-m365']).toMatchObject({ kind: 'microsoft365', editable: true });
    expect(by['g-lic'].licenses).toEqual(['SPB']);
    expect(by['g-lic'].warnings.join(' ')).toMatch(/licencia/);
    for (const id of ['g-dyn', 'g-mail', 'g-ad', 'g-rol']) expect(by[id].editable, id).toBe(false);
    expect(by['g-dyn'].blockedReason).toMatch(/dinámica/);
    expect(by['g-rol'].blockedReason).toMatch(/PIM/);
  });

  it('separa correos e identificadores de un CSV y descarta encabezados', () => {
    const { tokens, ignored } = parseAccounts('UserPrincipalName;Nombre\n"usuario1@contoso-demo.cl";Juan\n<Usuario2@contoso-demo.cl>, 11111111-2222-3333-4444-555555555555');
    expect(tokens).toEqual(['usuario1@contoso-demo.cl', 'Usuario2@contoso-demo.cl', '11111111-2222-3333-4444-555555555555']);
    expect(ignored).toEqual(['UserPrincipalName', 'Nombre', 'Juan']);
  });

  it('previsualiza: nuevos, ya miembros, inexistentes, repetidos, invitados y deshabilitados', async () => {
    const graph = new SimulatedGraph();
    // u6 ya es miembro de SG-Finanzas; u3 está deshabilitado; u43 es invitado
    const p = await previewMembership(
      graph,
      'g-fin',
      'usuario7@contoso-demo.cl\nusuario1@contoso-demo.cl\nUSUARIO1@contoso-demo.cl\nnadie@contoso-demo.cl\nusuario4@contoso-demo.cl\nusuario44@contoso-demo.cl',
      'agregar',
    );
    expect(p.entries.map((e) => e.status)).toEqual(['ya-miembro', 'agregar', 'duplicado', 'no-encontrado', 'agregar', 'agregar']);
    expect(p.entries[4].notes).toContain('Cuenta deshabilitada');
    expect(p.entries[5].notes).toContain('Invitado externo');
    expect(p.counts).toMatchObject({ agregar: 3, 'ya-miembro': 1, 'no-encontrado': 1, duplicado: 1 });
    expect(graph.calls.some((c) => c.method !== 'GET')).toBe(false); // la previsualización no escribe
  });

  it('agrega en lote, verifica releyendo y permite revertir', async () => {
    const graph = new SimulatedGraph();
    const list = Array.from({ length: 25 }, (_, i) => `usuario${i + 21}@contoso-demo.cl`).join('\n');
    const out = await applyMembership(graph, 'g-ven', list, 'agregar');
    // usuario21 = u20 ya estaba en SG-Ventas (u12..u20)
    expect(out.preview.counts['ya-miembro']).toBe(1);
    expect(out.changes).toHaveLength(24);
    expect(out.changes.every((c) => c.status === 'agregado' && c.verified)).toBe(true);
    expect(graph.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2); // 20 + 4
    expect(out.before).toHaveLength(9);
    expect(out.after).toHaveLength(33);

    const undo = await applyMembership(graph, 'g-ven', out.changes.map((c) => c.upn), 'quitar');
    expect(undo.changes.every((c) => c.status === 'quitado' && c.verified)).toBe(true);
    expect(await listMembers(graph, 'g-ven')).toHaveLength(9);
  });

  it('si un lote falla, reintenta cuenta por cuenta y aísla el error', async () => {
    const graph = new SimulatedGraph();
    const patch = graph.patch.bind(graph);
    graph.patch = async (p: string, body: any) => {
      if (body?.['members@odata.bind']) throw Object.assign(new Error('lote rechazado'), { status: 400 });
      return patch(p, body);
    };
    const post = graph.post.bind(graph);
    graph.post = async (p: string, body: any) => {
      if (String(body?.['@odata.id']).endsWith('/u31')) throw new Error('Insufficient privileges');
      return post(p, body);
    };
    const out = await applyMembership(graph, 'g-fin', 'usuario31@contoso-demo.cl usuario32@contoso-demo.cl', 'agregar');
    expect(out.changes.map((c) => c.status)).toEqual(['agregado', 'error']);
    expect(out.changes[1].error).toMatch(/Insufficient/);
  });

  it('rechaza grupos dinámicos, asignables a roles y listas sin cambios', async () => {
    const graph = new SimulatedGraph();
    await expect(applyMembership(graph, 'g-dyn', 'usuario1@contoso-demo.cl', 'agregar')).rejects.toThrow(/dinámica/);
    await expect(applyMembership(graph, 'g-rol', 'usuario1@contoso-demo.cl', 'agregar')).rejects.toThrow(/PIM/);
    await expect(applyMembership(graph, 'g-fin', 'usuario7@contoso-demo.cl', 'agregar')).rejects.toThrow(/No hay cuentas nuevas/);
    expect(graph.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('un grupo excluido de Acceso Condicional exige aceptar el riesgo', async () => {
    const graph = new SimulatedGraph();
    await graph.post('/identity/conditionalAccess/policies', {
      displayName: 'GOB-CA02 MFA para todos',
      state: 'enabled',
      conditions: { users: { includeUsers: ['All'], excludeGroups: ['g-fin'] } },
    });
    const [fin] = (await listSecurityGroups(graph)).filter((g) => g.id === 'g-fin');
    expect(fin.conditionalAccess.exclude).toEqual(['GOB-CA02 MFA para todos']);
    expect(fin.warnings.join(' ')).toMatch(/Excluido de 1 política/);
    await expect(applyMembership(graph, 'g-fin', 'usuario30@contoso-demo.cl', 'agregar')).rejects.toThrow(/riesgo/);
    const ok = await applyMembership(graph, 'g-fin', 'usuario30@contoso-demo.cl', 'agregar', { ackRisk: true });
    expect(ok.changes[0].status).toBe('agregado');
  });
});

describe('API de grupos', () => {
  beforeAll(async () => {
    await request(app).post('/api/simulation/reset').set(auth()).expect(200);
  });

  it('lista, previsualiza, aplica y deja evidencia en el historial', async () => {
    const list = await request(app).get('/api/groups').set(auth()).expect(200);
    expect(list.body.groups.some((g: any) => g.displayName === 'SG-Finanzas')).toBe(true);

    const detail = await request(app).get('/api/groups/g-fin').set(auth()).expect(200);
    expect(detail.body.members).toHaveLength(6);

    const accounts = 'usuario30@contoso-demo.cl\nusuario31@contoso-demo.cl\nno-existe@contoso-demo.cl';
    const preview = await request(app).post('/api/groups/g-fin/members/preview').set(auth()).send({ accounts }).expect(200);
    expect(preview.body.counts).toMatchObject({ agregar: 2, 'no-encontrado': 1 });

    const applied = await request(app).post('/api/groups/g-fin/members/apply').set(auth()).send({ accounts, mode: 'agregar' }).expect(200);
    expect(applied.body).toMatchObject({ status: 'completado', before: 6, after: 8 });
    expect(applied.body.evidenceHash).toMatch(/^[0-9a-f]{64}$/);

    const jobs = (await request(app).get('/api/jobs').set(auth())).body;
    expect(jobs[0]).toMatchObject({ id: applied.body.jobId, kind: 'grupos' });
    const doc = await request(app).get(`/api/docs/evidence/${applied.body.jobId}`).set(auth()).expect(200);
    expect(doc.text).toContain('Acta de cambio de membresía de grupo');
    expect(doc.text).toContain('usuario31@contoso-demo.cl');
    expect(doc.text).toContain('A.5.18');
    expect(doc.text).toContain('verificada');
  });

  it('grupo inexistente o id inválido', async () => {
    expect((await request(app).get('/api/groups/no-existe').set(auth())).status).toBe(404);
    expect((await request(app).get('/api/groups/..%2Fusers').set(auth())).status).toBe(400);
  });
});
