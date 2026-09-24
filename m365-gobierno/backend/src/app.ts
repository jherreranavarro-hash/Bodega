import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config, currentMode, graphConfigured, powershellConfigured } from './config.js';
import { login, requireAuth } from './auth.js';
import { TILES, GROUP_LABELS } from './catalog/tiles.js';
import { PLAYBOOKS, getPlaybook } from './playbooks/index.js';
import { PROFILES, type Playbook, type Profile } from './engine/types.js';
import { dependenciesOf, executePlan, missingPermissions, normalizeParams, resolvePlan, type PlanItemInput } from './engine/runner.js';
import { getJob, jobEvents, listJobs, startJob } from './engine/jobs.js';
import { load, save } from './store.js';
import { graphFor, grantedRoles, psRunner, simulatedGraph, tenantInfo } from './tenant.js';
import { buildScript, pwshAvailable } from './powershell/runner.js';
import { scanTenant } from './assessment/scan.js';
import { DEFAULT_QUESTIONNAIRE, PHASES, recommend, type Questionnaire } from './assessment/recommend.js';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function serializePlaybook(pb: Playbook) {
  const { run: _run, script: _script, dependsOn: _deps, ...rest } = pb;
  return { ...rest, defaultDependsOn: dependenciesOf(pb, normalizeParams(pb)), defaults: normalizeParams(pb) };
}

const requiredPermissions = () => [...new Set(PLAYBOOKS.flatMap((p) => p.permissions))].sort();

function parseItems(body: any): PlanItemInput[] {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items
    .filter((i: any) => typeof i?.playbookId === 'string')
    .map((i: any) => ({ playbookId: i.playbookId, params: typeof i.params === 'object' && i.params ? i.params : {} }));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const token = login(req.body?.password);
    if (!token) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ token });
  });

  app.use('/api', requireAuth);

  app.get(
    '/api/status',
    wrap(async (_req, res) => {
      const mode = currentMode();
      let tenant: unknown;
      let tenantError: string | undefined;
      try {
        tenant = await tenantInfo(mode);
      } catch (e: any) {
        tenantError = e?.message;
      }
      res.json({
        mode,
        graphConfigured: graphConfigured(),
        powershellConfigured: powershellConfigured(),
        pwshAvailable: await pwshAvailable(),
        forcedSimulation: config.forceSimulation,
        tenantId: config.tenantId ?? null,
        clientId: config.clientId ?? null,
        tenant,
        tenantError,
      });
    }),
  );

  app.get(
    '/api/permissions',
    wrap(async (_req, res) => {
      const required = requiredPermissions();
      let granted: string[] | undefined;
      let error: string | undefined;
      try {
        granted = await grantedRoles();
      } catch (e: any) {
        error = e?.message;
      }
      res.json({ required, granted: granted ?? null, missing: granted ? missingPermissions(required, granted) : null, error });
    }),
  );

  app.get('/api/catalog', (_req, res) => {
    res.json({
      tiles: TILES,
      groups: GROUP_LABELS,
      playbooks: PLAYBOOKS.map(serializePlaybook),
      profiles: PROFILES,
      phases: PHASES,
      requiredPermissions: requiredPermissions(),
    });
  });

  app.get('/api/state', (_req, res) => {
    const mode = currentMode();
    const s = load();
    res.json({
      mode,
      deployments: s.deployments[mode],
      manualDone: s.manualDone[mode],
      plan: s.plan,
      assessment: s.assessment[mode] ?? null,
    });
  });

  app.put('/api/plan', (req, res) => {
    const items = parseItems(req.body).filter((i) => getPlaybook(i.playbookId));
    save((s) => {
      s.plan = items;
    });
    res.json({ plan: items });
  });

  app.post(
    '/api/plan/preview',
    wrap(async (req, res) => {
      const mode = currentMode();
      const { items, errors } = resolvePlan(parseItems(req.body));
      if (errors.length) return res.status(400).json({ errors });
      const tenant = await tenantInfo(mode);
      const results = await executePlan(items, {
        graph: graphFor(mode),
        mode,
        dryRun: true,
        tenant,
        grantedRoles: await grantedRoles(mode).catch(() => undefined),
        manualDone: load().manualDone[mode],
        runPowerShell: psRunner(mode, tenant, () => {}),
      });
      res.json({ mode, results, order: items.map((i) => ({ playbookId: i.playbook.id, autoAdded: i.autoAdded, params: i.params })) });
    }),
  );

  app.post('/api/deploy', (req, res) => {
    const mode = currentMode();
    if (mode === 'real' && req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Confirma explícitamente el despliegue en el tenant real' });
    }
    if (listJobs().some((j) => j.status === 'en-curso')) {
      return res.status(409).json({ error: 'Ya hay un despliegue en curso' });
    }
    const { items, errors } = resolvePlan(parseItems(req.body));
    if (errors.length) return res.status(400).json({ errors });
    if (!items.length) return res.status(400).json({ error: 'El plan está vacío' });
    const job = startJob(items, mode);
    res.status(202).json({ jobId: job.id });
  });

  app.get('/api/jobs', (_req, res) => {
    res.json(listJobs().map(({ log: _log, ...j }) => j));
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'No existe el despliegue' });
    res.json(job);
  });

  app.get('/api/jobs/:id/events', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    for (const l of job.log) send({ type: 'log', ...l });
    for (const r of job.results) send({ type: 'result', result: r });
    if (job.status !== 'en-curso') {
      send({ type: 'done', status: job.status });
      return res.end();
    }
    const listener = (ev: any) => {
      send(ev);
      if (ev.type === 'done') res.end();
    };
    jobEvents.on(job.id, listener);
    req.on('close', () => jobEvents.off(job.id, listener));
  });

  app.post('/api/manual/:id', (req, res) => {
    const pb = getPlaybook(req.params.id);
    if (!pb) return res.status(404).json({ error: 'No existe el playbook' });
    const mode = currentMode();
    const done = req.body?.done === true;
    save((s) => {
      if (done) {
        s.manualDone[mode][pb.id] = new Date().toISOString();
        if (pb.engine === 'manual') {
          s.deployments[mode][pb.id] = { playbookId: pb.id, status: 'ok', params: {}, at: new Date().toISOString(), jobId: 'manual', summary: 'Pasos manuales completados' };
        }
      } else {
        delete s.manualDone[mode][pb.id];
        if (pb.engine === 'manual') delete s.deployments[mode][pb.id];
      }
    });
    res.json({ ok: true });
  });

  app.post(
    '/api/playbooks/:id/script',
    wrap(async (req, res) => {
      const pb = getPlaybook(req.params.id);
      if (!pb?.script || pb.engine === 'graph' || pb.engine === 'manual') return res.status(404).json({ error: 'Este playbook no usa PowerShell' });
      const tenant = await tenantInfo();
      const body = pb.script(normalizeParams(pb, req.body?.params ?? {}), tenant);
      res.type('text/plain').send(buildScript(pb.engine, body, { interactive: true }));
    }),
  );

  app.post(
    '/api/assessment',
    wrap(async (req, res) => {
      const mode = currentMode();
      const q: Questionnaire = { ...DEFAULT_QUESTIONNAIRE, ...(req.body?.questionnaire ?? {}) };
      const profile = PROFILES.includes(req.body?.profile) ? (req.body.profile as Profile) : undefined;
      const scan = await scanTenant(graphFor(mode));
      const recommendation = recommend(scan, q, load().deployments[mode], profile);
      const result = { at: new Date().toISOString(), mode, questionnaire: q, scan, recommendation };
      save((s) => {
        s.assessment[mode] = result;
      });
      res.json(result);
    }),
  );

  app.post('/api/simulation/reset', (_req, res) => {
    simulatedGraph().reset();
    save((s) => {
      s.deployments.simulacion = {};
      s.manualDone.simulacion = {};
      delete s.assessment.simulacion;
    });
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Frontend compilado (producción)
  if (fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist));
    app.get('*', (_req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err?.message ?? 'Error interno', code: err?.code });
  });

  return app;
}
