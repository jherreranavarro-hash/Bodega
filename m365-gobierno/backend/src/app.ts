import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config, powershellConfigured } from './config.js';
import { login, requireAuth } from './auth.js';
import { completeLogin, logout, redirectUri, sessionInfo, startLogin, signedInAccount } from './auth/delegated.js';
import { TILES, GROUP_LABELS } from './catalog/tiles.js';
import { PLAYBOOKS, getPlaybook } from './playbooks/index.js';
import { PROFILES, type Playbook, type Profile } from './engine/types.js';
import { dependenciesOf, executePlan, missingPermissions, normalizeParams, resolvePlan, type PlanItemInput } from './engine/runner.js';
import { getJob, jobEvents, listJobs, startJob } from './engine/jobs.js';
import { deploymentsOf, load, manualDoneOf, save } from './store.js';
import {
  activeEnvironment,
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  listEnvironments,
  modeOf,
  setActiveEnvironment,
  updateEnvironment,
  type EnvRef,
} from './environments.js';
import { forgetTenant, graphFor, grantedRoles, psRunner, simulatedGraph, tenantInfo } from './tenant.js';
import { buildScript, pwshAvailable } from './powershell/runner.js';
import { scanTenant } from './assessment/scan.js';
import { DEFAULT_QUESTIONNAIRE, PHASES, recommend, type Questionnaire, type Recommendation } from './assessment/recommend.js';
import { renderEvidence, renderPillarPolicy, renderPlaybookProcedure, renderRoadmap, type DocContext } from './docs/render.js';
import { METRIC_DEFS, computeMetrics } from './metrics.js';
import { recordSnapshot, snapshotsOf, takeSnapshot } from './snapshots.js';
import { runProbes, simulatedProbe } from './assessment/probe.js';
import { loadEvidence } from './store.js';
import type { Pillar } from './engine/types.js';

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

function envView(env: EnvRef) {
  const session = env.kind === 'delegado' ? sessionInfo(env.id) : null;
  return { ...env, session, connected: env.kind !== 'delegado' || Boolean(session) };
}

/** Playbooks desplegados correctamente en ambientes DEV/POC (validación previa a PRD). */
function validatedInLower(): Record<string, string[]> {
  const s = load();
  const out: Record<string, string[]> = {};
  for (const env of listEnvironments().filter((e) => e.tier === 'dev' || e.tier === 'poc')) {
    for (const [id, d] of Object.entries(s.deployments[env.id] ?? {})) {
      if (d.status === 'ok') (out[id] ??= []).push(env.name);
    }
  }
  return out;
}

async function docContext(env: EnvRef, query: Record<string, unknown>): Promise<DocContext> {
  const s = load();
  const assessment = s.assessment[env.id] as { at?: string; questionnaire?: Questionnaire; scan?: any; recommendation?: Recommendation } | undefined;
  let tenantDomain: string | undefined;
  if (envView(env).connected) {
    const t = await tenantInfo(env).catch(() => undefined);
    tenantDomain = t?.defaultDomain ?? t?.initialDomain;
  }
  const text = (k: string) => (typeof query[k] === 'string' ? String(query[k]).slice(0, 120) : undefined);
  return {
    org: assessment?.questionnaire?.company || assessment?.scan?.org?.name || env.name,
    envName: env.name,
    envTier: env.tier,
    tenantDomain,
    author: text('author') ?? signedInAccountOf(env),
    approver: text('approver'),
    deployments: s.deployments[env.id] ?? {},
    planParams: Object.fromEntries(s.plan.map((p) => [p.playbookId, p.params ?? {}])),
    recommendation: assessment?.recommendation,
    assessmentAt: assessment?.at,
  };
}

/** Lectura por PowerShell de Defender for Office 365 y Purview (en simulación, datos de ejemplo). */
function probeFor(env: EnvRef) {
  return async () => {
    if (env.kind === 'simulacion') return simulatedProbe();
    const tenant = await tenantInfo(env);
    return runProbes(psRunner(env, tenant, () => {}));
  };
}

const signedInAccountOf = (env: EnvRef) => (env.kind === 'delegado' ? signedInAccount(env.id) : undefined);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const token = login(req.body?.password);
    if (!token) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ token });
  });

  // Regreso desde la página de Microsoft (navegación del navegador, sin cabecera de sesión).
  // Lo protege el parámetro `state` de un solo uso generado en /api/auth/login.
  app.get('/api/auth/callback', async (req, res) => {
    try {
      const { envId, info } = await completeLogin(req.query);
      const env = getEnvironment(envId);
      if (env) forgetTenant(env);
      res.redirect(`/#connection?login=ok&account=${encodeURIComponent(info.account)}`);
    } catch (e: any) {
      res.redirect(`/#connection?login=error&msg=${encodeURIComponent(e?.message ?? 'Error de inicio de sesión')}`);
    }
  });

  app.use('/api', requireAuth);

  // ---------- Ambientes (DEV / POC / PRD) ----------
  app.get('/api/environments', (_req, res) => {
    res.json({ active: activeEnvironment().id, redirectUri: redirectUri(), environments: listEnvironments().map(envView) });
  });
  app.post('/api/environments', (req, res) => res.status(201).json(envView(createEnvironment(req.body))));
  app.put('/api/environments/:id', (req, res) => {
    const before = getEnvironment(req.params.id);
    if (!before || before.kind !== 'delegado') return res.status(404).json({ error: 'Ambiente no editable' });
    const env = updateEnvironment(req.params.id, req.body);
    // Si cambió el tenant, la app o la cuenta, la sesión anterior deja de ser válida
    if (before.tenantId !== env.tenantId || before.clientId !== env.clientId || before.adminUpn !== env.adminUpn) logout(env.id);
    forgetTenant(before);
    res.json(envView(env));
  });
  app.delete('/api/environments/:id', (req, res) => {
    const env = getEnvironment(req.params.id);
    if (!env || env.kind !== 'delegado') return res.status(404).json({ error: 'Ambiente no eliminable' });
    logout(env.id);
    forgetTenant(env);
    deleteEnvironment(env.id);
    res.json({ ok: true });
  });
  app.post('/api/environments/:id/activate', (req, res) => {
    if (listJobs().some((j) => j.status === 'en-curso')) return res.status(409).json({ error: 'Espera a que termine el despliegue en curso' });
    res.json(envView(setActiveEnvironment(req.params.id)));
  });

  app.post('/api/auth/login/:envId', (req, res) => {
    const env = getEnvironment(req.params.envId);
    if (!env || env.kind !== 'delegado') return res.status(404).json({ error: 'Ambiente inexistente' });
    res.json({ url: startLogin(env) });
  });
  app.post('/api/auth/logout/:envId', (req, res) => {
    logout(req.params.envId);
    res.json({ ok: true });
  });

  app.get(
    '/api/status',
    wrap(async (_req, res) => {
      const env = activeEnvironment();
      let tenant: unknown;
      let tenantError: string | undefined;
      const view = envView(env);
      if (view.connected) {
        try {
          tenant = await tenantInfo(env);
        } catch (e: any) {
          tenantError = e?.message;
        }
      }
      res.json({
        mode: modeOf(env),
        environment: view,
        powershellConfigured: env.kind === 'delegado' ? true : powershellConfigured(),
        pwshAvailable: await pwshAvailable(),
        forcedSimulation: config.forceSimulation,
        tenant,
        tenantError,
      });
    }),
  );

  app.get(
    '/api/permissions',
    wrap(async (_req, res) => {
      const env = activeEnvironment();
      const required = requiredPermissions();
      let granted: string[] | undefined;
      let error: string | undefined;
      try {
        granted = await grantedRoles(env);
      } catch (e: any) {
        error = e?.message;
      }
      res.json({ kind: env.kind, required, granted: granted ?? null, missing: granted ? missingPermissions(required, granted) : null, error });
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
    const env = activeEnvironment();
    const s = load();
    res.json({
      mode: modeOf(env),
      environment: envView(env),
      deployments: s.deployments[env.id] ?? {},
      manualDone: s.manualDone[env.id] ?? {},
      plan: s.plan,
      assessment: s.assessment[env.id] ?? null,
      validatedInLower: validatedInLower(),
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
      const env = activeEnvironment();
      const { items, errors } = resolvePlan(parseItems(req.body));
      if (errors.length) return res.status(400).json({ errors });
      const tenant = await tenantInfo(env);
      const results = await executePlan(items, {
        graph: graphFor(env),
        mode: modeOf(env),
        dryRun: true,
        tenant,
        grantedRoles: await grantedRoles(env).catch(() => undefined),
        manualDone: load().manualDone[env.id] ?? {},
        runPowerShell: psRunner(env, tenant, () => {}),
      });
      res.json({ environment: env.name, results, order: items.map((i) => ({ playbookId: i.playbook.id, autoAdded: i.autoAdded, params: i.params })) });
    }),
  );

  app.post(
    '/api/deploy',
    wrap(async (req, res) => {
      const env = activeEnvironment();
      if (env.kind !== 'simulacion' && req.body?.confirm !== true) {
        return res.status(400).json({ error: `Confirma explícitamente el despliegue en ${env.name}` });
      }
      if (env.tier === 'prd' && String(req.body?.confirmText ?? '').trim() !== env.name) {
        return res.status(400).json({ error: `Producción: escribe "${env.name}" para confirmar el despliegue` });
      }
      if (listJobs().some((j) => j.status === 'en-curso')) {
        return res.status(409).json({ error: 'Ya hay un despliegue en curso' });
      }
      const { items, errors } = resolvePlan(parseItems(req.body));
      if (errors.length) return res.status(400).json({ errors });
      if (!items.length) return res.status(400).json({ error: 'El plan está vacío' });
      if (env.kind === 'delegado') {
        // Valida la sesión (y la renueva) antes de empezar, para no fallar a mitad de camino
        await tenantInfo(env);
      }
      const job = startJob(items, env, env.kind === 'delegado' ? signedInAccount(env.id) : undefined);
      res.status(202).json({ jobId: job.id });
    }),
  );

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
    const env = activeEnvironment();
    const done = req.body?.done === true;
    save((s) => {
      const manual = manualDoneOf(s, env.id);
      const deployments = deploymentsOf(s, env.id);
      if (done) {
        manual[pb.id] = new Date().toISOString();
        if (pb.engine === 'manual') {
          deployments[pb.id] = { playbookId: pb.id, status: 'ok', params: {}, at: new Date().toISOString(), jobId: 'manual', summary: 'Pasos manuales completados' };
        }
      } else {
        delete manual[pb.id];
        if (pb.engine === 'manual') delete deployments[pb.id];
      }
    });
    res.json({ ok: true });
  });

  app.post(
    '/api/playbooks/:id/script',
    wrap(async (req, res) => {
      const pb = getPlaybook(req.params.id);
      if (!pb?.script || pb.engine === 'graph' || pb.engine === 'manual') return res.status(404).json({ error: 'Este playbook no usa PowerShell' });
      const env = activeEnvironment();
      const tenant = envView(env).connected ? await tenantInfo(env).catch(() => ({})) : {};
      const body = pb.script(normalizeParams(pb, req.body?.params ?? {}), tenant);
      res.type('text/plain').send(buildScript(pb.engine, body, 'interactive'));
    }),
  );

  app.post(
    '/api/assessment',
    wrap(async (req, res) => {
      const env = activeEnvironment();
      const q: Questionnaire = { ...DEFAULT_QUESTIONNAIRE, ...(req.body?.questionnaire ?? {}) };
      const profile = PROFILES.includes(req.body?.profile) ? (req.body.profile as Profile) : undefined;
      const scan = await scanTenant(graphFor(env), { probe: probeFor(env) });
      const recommendation = recommend(scan, q, load().deployments[env.id] ?? {}, profile);
      const result = { at: new Date().toISOString(), mode: modeOf(env), environment: env.name, questionnaire: q, scan, recommendation };
      save((s) => {
        s.assessment[env.id] = result;
      });
      recordSnapshot(env.id, { at: result.at, source: 'assessment', values: computeMetrics(scan, load().deployments[env.id] ?? {}, q) });
      res.json(result);
    }),
  );

  // ---------- Documentos formales (HTML imprimible) ----------
  const sendDoc = (res: Response, html: string) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    res.type('html').send(html);
  };
  app.get(
    '/api/docs/roadmap',
    wrap(async (req, res) => {
      const env = activeEnvironment();
      const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start ?? '')) ? String(req.query.start) : new Date().toISOString().slice(0, 10);
      const weeks = String(req.query.weeks ?? '1,2,4,6,8')
        .split(',')
        .map((n) => Math.min(52, Math.max(1, Number(n) || 2)));
      sendDoc(res, renderRoadmap(await docContext(env, req.query), { start, weeks }));
    }),
  );
  app.get(
    '/api/docs/policy/:pillar',
    wrap(async (req, res) => {
      const pillar = req.params.pillar as Pillar;
      if (!['entra', 'intune', 'defender', 'purview'].includes(pillar)) return res.status(404).json({ error: 'Módulo inexistente' });
      sendDoc(res, renderPillarPolicy(pillar, await docContext(activeEnvironment(), req.query)));
    }),
  );
  app.get(
    '/api/docs/playbook/:id',
    wrap(async (req, res) => {
      const pb = getPlaybook(req.params.id);
      if (!pb) return res.status(404).json({ error: 'Playbook inexistente' });
      sendDoc(res, renderPlaybookProcedure(pb, await docContext(activeEnvironment(), req.query)));
    }),
  );
  app.get(
    '/api/docs/evidence/:jobId',
    wrap(async (req, res) => {
      const ev = loadEvidence(req.params.jobId);
      if (!ev) return res.status(404).json({ error: 'No hay evidencia para este despliegue' });
      const env = getEnvironment(ev.record.environment?.id) ?? activeEnvironment();
      if (req.query.format === 'json') {
        res.setHeader('Content-Disposition', `attachment; filename="evidencia-${req.params.jobId}.json"`);
        return res.json({ sha256: ev.hash, integra: ev.valid, ...ev.record });
      }
      sendDoc(res, renderEvidence(ev, await docContext(env, req.query)));
    }),
  );

  // ---------- Métricas (antes / después) ----------
  app.get('/api/metrics', (_req, res) => {
    const env = activeEnvironment();
    res.json({ environment: env.name, defs: METRIC_DEFS, snapshots: snapshotsOf(env.id) });
  });
  app.post('/api/metrics/reset', (_req, res) => {
    const env = activeEnvironment();
    save((s) => {
      s.metrics[env.id] = [];
    });
    res.json({ ok: true });
  });
  app.post(
    '/api/metrics/snapshot',
    wrap(async (_req, res) => {
      res.status(201).json(await takeSnapshot(activeEnvironment(), 'manual'));
    }),
  );

  app.post('/api/simulation/reset', (_req, res) => {
    simulatedGraph().reset();
    save((s) => {
      delete s.deployments.simulacion;
      delete s.manualDone.simulacion;
      delete s.assessment.simulacion;
      delete s.metrics.simulacion;
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
