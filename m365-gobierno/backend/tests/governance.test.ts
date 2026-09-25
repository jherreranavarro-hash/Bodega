import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

let app: any;
let token: string;
let dataDir: string;
let jobId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gob-gov-'));
  process.env.DATA_DIR = dataDir;
  process.env.APP_PASSWORD = 'clave';
  const { createApp } = await import('../src/app.js');
  app = createApp();
  token = (await request(app).post('/api/login').send({ password: 'clave' })).body.token;
});

async function waitJob(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = (await request(app).get(`/api/jobs/${id}`).set(auth())).body;
    if (job.status !== 'en-curso') return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}

describe('gobierno: documentos, evidencia y métricas', () => {
  it('todos los playbooks tienen controles ISO 27001 mapeados', async () => {
    // Import dinámico: config.ts debe leer DATA_DIR/APP_PASSWORD definidos en beforeAll
    const { PLAYBOOKS } = await import('../src/playbooks/index.js');
    const { MAPPED_PLAYBOOKS } = await import('../src/compliance/controls.js');
    expect(PLAYBOOKS.map((p) => p.id).filter((id) => !MAPPED_PLAYBOOKS.includes(id))).toEqual([]);
  });

  it('el despliegue registra evidencia antes/después íntegra y métricas', async () => {
    const a = await request(app).post('/api/assessment').set(auth()).send({ questionnaire: { company: 'Phoenix Demo SpA' } });
    const items = a.body.recommendation.items.filter((i: any) => i.phase <= 1).map((i: any) => ({ playbookId: i.playbookId, params: i.params }));
    const dep = await request(app).post('/api/deploy').set(auth()).send({ items });
    jobId = dep.body.jobId;
    const job = await waitJob(jobId);
    expect(job.metrics.before.overall).toBeTypeOf('number');
    expect(job.metrics.after.controlsDeployed).toBeGreaterThan(job.metrics.before.controlsDeployed);
    expect(job.evidenceHash).toMatch(/^[0-9a-f]{64}$/);

    const ev = (await request(app).get(`/api/docs/evidence/${jobId}?format=json`).set(auth())).body;
    expect(ev.integra).toBe(true);
    const sd = ev.results.find((r: any) => r.playbookId === 'entra-security-defaults');
    const patch = sd.evidence.find((e: any) => e.resource === '/policies/identitySecurityDefaultsEnforcementPolicy');
    expect(patch.before.isEnabled).toBe(true);
    expect(patch.after.isEnabled).toBe(false);
    const ca = ev.results.find((r: any) => r.playbookId === 'entra-ca-admins-mfa').evidence[0];
    expect(ca.before).toBeNull();
    expect(ca.after.displayName).toContain('CA01');
    const ps = ev.results.find((r: any) => r.playbookId === 'defender-safe-links').evidence[0];
    expect(ps.method).toBe('SCRIPT');

    const metrics = (await request(app).get('/api/metrics').set(auth())).body;
    expect(metrics.snapshots.map((s: any) => s.source)).toEqual(['assessment', 'antes-despliegue', 'despues-despliegue']);
  });

  it('genera el acta de evidencia y detecta manipulación', async () => {
    const html = (await request(app).get(`/api/docs/evidence/${jobId}`).set(auth())).text;
    expect(html).toContain('Acta de evidencia de despliegue');
    expect(html).toContain('Cómo estaba (antes)');
    expect(html).toContain('A.8.5');
    expect(html).toContain('verificada');
    const file = path.join(dataDir, 'evidencia', `${jobId}.json`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"ok"', '"error"'));
    const tampered = (await request(app).get(`/api/docs/evidence/${jobId}`).set(auth())).text;
    expect(tampered).toContain('NO coincide');
  });

  it('genera declaración/hoja de ruta, políticas por módulo y procedimientos', async () => {
    const roadmap = await request(app).get('/api/docs/roadmap?start=2026-10-01&weeks=1,2,4,6,8&approver=Gerencia').set(auth());
    expect(roadmap.status).toBe(200);
    expect(roadmap.text).toContain('Declaración de aplicabilidad');
    expect(roadmap.text).toContain('Phoenix Demo SpA');
    expect(roadmap.text).toContain('Ley N° 21.719');
    expect(roadmap.text).toContain('Implementado');
    for (const p of ['entra', 'intune', 'defender', 'purview']) {
      const r = await request(app).get(`/api/docs/policy/${p}`).set(auth());
      expect(r.status).toBe(200);
      expect(r.text).toContain('Declaraciones de política');
    }
    const prc = await request(app).get('/api/docs/playbook/purview-dlp').set(auth());
    expect(prc.text).toContain('Plan de reversa');
    expect(prc.text).toContain('A.8.12');
    // Los valores vienen escapados (sin inyección de HTML)
    expect(prc.text).not.toContain('<script>alert');
  });
});
