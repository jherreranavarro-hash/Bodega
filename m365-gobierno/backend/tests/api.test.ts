import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

let app: any;
let token: string;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gob-'));
  process.env.APP_PASSWORD = 'clave-de-prueba';
  
  const { createApp } = await import('../src/app.js');
  app = createApp();
  token = (await request(app).post('/api/login').send({ password: 'clave-de-prueba' })).body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('API', () => {
  it('exige sesión', async () => {
    expect((await request(app).get('/api/catalog')).status).toBe(401);
    expect((await request(app).post('/api/login').send({ password: 'mala' })).status).toBe(401);
  });

  it('entrega catálogo sin funciones', async () => {
    const res = await request(app).get('/api/catalog').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.tiles.length).toBeGreaterThan(100);
    expect(res.body.playbooks[0].run).toBeUndefined();
  });

  it('assessment → previsualización → despliegue', async () => {
    const a = await request(app).post('/api/assessment').set(auth()).send({ questionnaire: { company: 'Contoso' } });
    expect(a.status).toBe(200);
    const items = a.body.recommendation.items.filter((i: any) => i.phase <= 1).map((i: any) => ({ playbookId: i.playbookId, params: i.params }));

    const preview = await request(app).post('/api/plan/preview').set(auth()).send({ items });
    expect(preview.status).toBe(200);
    expect(preview.body.results.some((r: any) => r.steps.some((s: any) => s.action === 'crear'))).toBe(true);

    const dep = await request(app).post('/api/deploy').set(auth()).send({ items });
    expect(dep.status).toBe(202);
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await request(app).get(`/api/jobs/${dep.body.jobId}`).set(auth())).body;
      if (job.status !== 'en-curso') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(job.status, JSON.stringify(job.results.filter((r: any) => r.error))).toMatch(/completado|con-pendientes/);
    const state = (await request(app).get('/api/state').set(auth())).body;
    expect(state.deployments['entra-ca-admins-mfa'].status).toBe('ok');
  });

  it('genera script de PowerShell interactivo', async () => {
    const res = await request(app).post('/api/playbooks/defender-safe-links/script').set(auth()).send({ params: {} });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Connect-ExchangeOnline -UserPrincipalName');
    expect(res.text).toContain('New-SafeLinksPolicy');
  });
});
