import type { Params, ParamDef, Pillar, Playbook } from '../engine/types.js';
import { PLAYBOOKS, getPlaybook } from '../playbooks/index.js';
import { TILES } from '../catalog/tiles.js';
import { ISO_CONTROLS, LAW_DISCLAIMER, LAW_DUTIES, LAW_NAME, complianceFor } from '../compliance/controls.js';
import { PHASES, type Recommendation } from '../assessment/recommend.js';
import { METRIC_DEFS, type MetricValues } from '../metrics.js';
import type { DeploymentRecord } from '../store.js';
import type { EvidenceEntry } from '../engine/evidence.js';
import type { ItemResult } from '../engine/runner.js';

/* Documentos formales en HTML imprimible (el navegador los guarda como PDF). */

export interface DocContext {
  org: string;
  envName: string;
  envTier: string;
  tenantDomain?: string;
  author?: string;
  approver?: string;
  deployments: Record<string, DeploymentRecord>;
  planParams: Record<string, Params>;
  recommendation?: Recommendation;
  assessmentAt?: string;
}

const PILLAR_NAME: Record<Pillar, string> = { entra: 'Entra ID', intune: 'Intune', defender: 'Defender', purview: 'Purview' };
const PILLAR_POLICY: Record<Pillar, { code: string; title: string; objective: string; scope: string }> = {
  entra: {
    code: 'GOB-POL-IAM',
    title: 'Política de gestión de identidades y control de acceso',
    objective:
      'Asegurar que solo personas autorizadas, correctamente autenticadas y desde contextos confiables accedan a la información y servicios de Microsoft 365 de la organización.',
    scope: 'Todas las cuentas del directorio Microsoft Entra ID (colaboradores, administradores, invitados y cuentas de servicio) y todas las aplicaciones integradas.',
  },
  intune: {
    code: 'GOB-POL-END',
    title: 'Política de gestión y seguridad de dispositivos',
    objective:
      'Garantizar que los equipos y dispositivos móviles que acceden a información de la organización cumplan un nivel mínimo de seguridad y sean administrados de forma centralizada.',
    scope: 'Equipos Windows y macOS corporativos, y dispositivos iOS/Android (corporativos o personales) que acceden a Microsoft 365.',
  },
  defender: {
    code: 'GOB-POL-THR',
    title: 'Política de protección contra amenazas',
    objective:
      'Prevenir, detectar y responder a malware, phishing, ransomware y otras amenazas sobre el correo, la colaboración y los puntos de conexión.',
    scope: 'Exchange Online, SharePoint, OneDrive, Teams y todos los dispositivos incorporados a Microsoft Defender for Business.',
  },
  purview: {
    code: 'GOB-POL-DAT',
    title: 'Política de clasificación, protección y ciclo de vida de la información',
    objective:
      'Clasificar y proteger la información según su sensibilidad, prevenir su fuga, conservarla el tiempo requerido y mantener registros auditables, incluyendo los datos personales.',
    scope: 'Correo, documentos, chats y sitios de Microsoft 365, incluida la información personal de clientes y colaboradores.',
  },
};

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtDateTime = (d: string | Date) => new Date(d).toLocaleString('es-CL');

function formatParam(def: ParamDef, v: unknown): string {
  if (def.type === 'boolean') return v ? 'Sí' : 'No';
  if (def.type === 'select') return def.options?.find((o) => o.value === v)?.label ?? String(v);
  if (def.type === 'multiselect') {
    const arr = Array.isArray(v) ? v : [];
    return arr.map((x) => def.options?.find((o) => o.value === x)?.label ?? x).join(', ') || '(ninguno)';
  }
  if (def.type === 'list') return Array.isArray(v) && v.length ? v.join(', ') : '(ninguno)';
  return v === '' || v === undefined ? '(vacío)' : String(v);
}

function paramsOf(pb: Playbook, ctx: DocContext): Params {
  return {
    ...Object.fromEntries(pb.params.map((d) => [d.key, d.default])),
    ...(ctx.recommendation?.items.find((i) => i.playbookId === pb.id)?.params ?? {}),
    ...(ctx.deployments[pb.id]?.params ?? {}),
    ...(ctx.planParams[pb.id] ?? {}),
  };
}

function statusOf(pb: Playbook, ctx: DocContext): { label: string; cls: string } {
  const d = ctx.deployments[pb.id];
  if (d?.status === 'ok') return { label: `Implementado (${fmtDate(d.at)})`, cls: 'ok' };
  if (d?.status === 'manual') return { label: 'En curso: pasos manuales pendientes', cls: 'warn' };
  if (d?.status === 'error') return { label: 'Con error en el último intento', cls: 'err' };
  if (ctx.planParams[pb.id] || ctx.recommendation?.items.some((i) => i.playbookId === pb.id)) return { label: `Planificado (fase ${pb.phase})`, cls: 'plan' };
  return { label: 'No planificado', cls: 'muted' };
}

const ENGINE: Record<Playbook['engine'], string> = {
  graph: 'Automatizado vía Microsoft Graph API',
  exo: 'Automatizado vía Exchange Online PowerShell',
  ipps: 'Automatizado vía Security & Compliance PowerShell',
  manual: 'Guiado: pasos manuales en el portal de Microsoft',
};

const STYLE = `
*{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1c2430;margin:0;background:#eef0f3;font-size:13.5px;line-height:1.5}
.doc{background:#fff;max-width:860px;margin:24px auto;padding:48px 56px;box-shadow:0 2px 12px rgb(0 0 0/10%)}
.toolbar{position:sticky;top:0;background:#1c2430;color:#fff;padding:8px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-size:13px}
.toolbar button{background:#0b63ce;color:#fff;border:0;border-radius:6px;padding:6px 14px;font:inherit;font-weight:600;cursor:pointer}
header.dochead{display:grid;grid-template-columns:1fr auto;gap:8px;border-bottom:3px solid #0b63ce;padding-bottom:12px;margin-bottom:18px}
.org{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5d6878}
h1{font-size:22px;margin:4px 0}h2{font-size:15.5px;margin:22px 0 8px;color:#0b3d7a;border-bottom:1px solid #d9dde3;padding-bottom:4px}h3{font-size:14px;margin:14px 0 6px}
.meta{font-size:12px;text-align:right;color:#5d6878}.meta b{color:#1c2430}
table{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:12.5px}th,td{border:1px solid #d9dde3;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f4f8;font-weight:600}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.err{background:#fee2e2;color:#991b1b}.plan{background:#dbeafe;color:#1e40af}.muted{background:#f1f5f9;color:#475569}
.P1{background:#fee2e2;color:#991b1b}.P2{background:#fef3c7;color:#92400e}.P3{background:#f1f5f9;color:#475569}
.note{font-size:11.5px;color:#5d6878}.box{border-left:4px solid #0b63ce;background:#f5f8fc;padding:8px 12px;margin:8px 0}
pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border:1px solid #e3e6ea;padding:8px;font-size:11px;max-height:none}
.sign td{height:56px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{border:1px solid #d9dde3;border-radius:6px;padding:8px}.kpi b{font-size:18px;display:block}
.up{color:#15803d;font-weight:700}.down{color:#b91c1c;font-weight:700}
@media print{body{background:#fff}.toolbar{display:none}.doc{box-shadow:none;margin:0;max-width:none;padding:0}h2{break-after:avoid}tr,.box{break-inside:avoid}@page{margin:18mm 16mm}}
`;

function layout(o: { code: string; title: string; subtitle?: string; ctx: DocContext; version?: string; body: string }) {
  const today = new Date();
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(o.code)} ${esc(o.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>
<div class="toolbar"><span>${esc(o.code)} · ${esc(o.title)}</span><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
<article class="doc">
<header class="dochead"><div><div class="org">${esc(o.ctx.org)}</div><h1>${esc(o.title)}</h1>${o.subtitle ? `<div>${esc(o.subtitle)}</div>` : ''}</div>
<div class="meta">Código: <b>${esc(o.code)}</b><br>Versión: <b>${esc(o.version ?? '1.0')}</b><br>Fecha: <b>${fmtDate(today)}</b><br>Ambiente: <b>${esc(o.ctx.envName)}</b>${o.ctx.tenantDomain ? `<br>Tenant: <b>${esc(o.ctx.tenantDomain)}</b>` : ''}<br>Clasificación: <b>Uso interno</b></div></header>
${o.body}
<h2>Aprobaciones</h2>
<table class="sign"><tr><th style="width:22%">Rol</th><th>Nombre</th><th style="width:22%">Firma</th><th style="width:18%">Fecha</th></tr>
<tr><td>Elaborado por</td><td>${esc(o.ctx.author ?? '')}</td><td></td><td></td></tr>
<tr><td>Revisado por (Seguridad de la información)</td><td></td><td></td><td></td></tr>
<tr><td>Aprobado por</td><td>${esc(o.ctx.approver ?? '')}</td><td></td><td></td></tr></table>
<p class="note">Documento generado por Gobierno M365 el ${fmtDateTime(today)}. ${esc(LAW_DISCLAIMER)}</p>
</article></body></html>`;
}

function complianceTable(pbs: Playbook[]) {
  const iso = new Map<string, Set<string>>();
  const law = new Map<string, Set<string>>();
  for (const pb of pbs) {
    const c = complianceFor(pb.id, pb.pillar);
    c.iso.forEach((x) => (iso.get(x.id) ?? iso.set(x.id, new Set()).get(x.id)!).add(pb.title));
    c.law.forEach((x) => (law.get(x.id) ?? law.set(x.id, new Set()).get(x.id)!).add(pb.title));
  }
  const isoRows = [...iso.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, set]) => `<tr><td>A.${esc(id)}</td><td>${esc(ISO_CONTROLS[id])}</td><td>${[...set].map(esc).join('; ')}</td></tr>`)
    .join('');
  const lawRows = [...law.entries()].map(([id, set]) => `<tr><td>${esc(LAW_DUTIES[id])}</td><td>${[...set].map(esc).join('; ')}</td></tr>`).join('');
  return `<h3>ISO/IEC 27001:2022 — Anexo A</h3><table><tr><th style="width:9%">Control</th><th style="width:36%">Nombre</th><th>Implementado mediante</th></tr>${isoRows}</table>
<h3>${esc(LAW_NAME)}</h3><table><tr><th style="width:45%">Principio / deber</th><th>Medidas que contribuyen</th></tr>${lawRows}</table>`;
}

function paramTable(pb: Playbook, params: Params) {
  if (!pb.params.length) return '<p>Configuración estándar recomendada por Microsoft, sin parámetros variables.</p>';
  return `<table><tr><th style="width:50%">Parámetro</th><th>Valor definido</th></tr>${pb.params
    .map((d) => `<tr><td>${esc(d.label)}</td><td>${esc(formatParam(d, params[d.key]))}</td></tr>`)
    .join('')}</table>`;
}

// ---------------------------------------------------------------------------
// 1. Declaración de aplicabilidad y hoja de ruta
// ---------------------------------------------------------------------------

export function renderRoadmap(ctx: DocContext, opts: { start: string; weeks: number[] }): string {
  const rec = ctx.recommendation;
  if (!rec) return layout({ code: 'GOB-DEC-01', title: 'Declaración y hoja de ruta', ctx, body: '<p>Ejecuta primero el Assessment en este ambiente.</p>' });
  const start = new Date(`${opts.start}T12:00:00`);
  let cursor = new Date(start);
  const phaseDates = PHASES.map((ph, i) => {
    const from = new Date(cursor);
    const to = new Date(cursor);
    to.setDate(to.getDate() + Math.max(1, opts.weeks[i] ?? 2) * 7 - 1);
    cursor = new Date(to);
    cursor.setDate(cursor.getDate() + 1);
    return { ...ph, from, to };
  });
  const sev = (s: string) => rec.findings.filter((f) => f.severity === s).length;
  const planned = rec.items.map((i) => getPlaybook(i.playbookId)!).filter(Boolean);

  const findings = rec.findings
    .map(
      (f) =>
        `<tr><td><span class="pill ${f.severity === 'critica' || f.severity === 'alta' ? 'err' : f.severity === 'media' ? 'warn' : 'muted'}">${esc(f.severity)}</span></td><td>${esc(PILLAR_NAME[f.pillar])}</td><td><b>${esc(f.title)}</b><br><span class="note">${esc(f.detail)}</span></td><td>${f.playbooks
          .map((id) => esc(getPlaybook(id)?.title ?? id))
          .join('<br>')}</td></tr>`,
    )
    .join('');

  const roadmap = phaseDates
    .map((ph) => {
      const items = rec.items.filter((i) => i.phase === ph.phase);
      if (!items.length) return '';
      return `<h3>Fase ${ph.phase} · ${esc(ph.name)} <span class="note">(${fmtDate(ph.from)} → ${fmtDate(ph.to)})</span></h3><p class="note">${esc(ph.description)}</p>
<table><tr><th style="width:7%">Prior.</th><th>Acción (playbook)</th><th style="width:12%">Módulo</th><th style="width:26%">Justificación</th><th style="width:18%">Estado</th></tr>${items
        .map((i) => {
          const pb = getPlaybook(i.playbookId)!;
          const st = statusOf(pb, ctx);
          return `<tr><td><span class="pill ${i.priority}">${i.priority}</span></td><td>${esc(pb.title)}<br><span class="note">${esc(ENGINE[pb.engine])}</span></td><td>${esc(PILLAR_NAME[pb.pillar])}</td><td class="note">${esc(i.reason)}</td><td><span class="pill ${st.cls}">${esc(st.label)}</span></td></tr>`;
        })
        .join('')}</table>`;
    })
    .join('');

  // Declaración de aplicabilidad: controles del Anexo A cubiertos por el plan
  const soa = new Map<string, Playbook[]>();
  for (const pb of planned) for (const c of complianceFor(pb.id, pb.pillar).iso) (soa.get(c.id) ?? soa.set(c.id, []).get(c.id)!).push(pb);
  const soaRows = [...soa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, pbs]) => {
      const done = pbs.filter((p) => ctx.deployments[p.id]?.status === 'ok').length;
      const st = done === pbs.length ? ['ok', 'Implementado'] : done > 0 ? ['warn', `Parcial (${done}/${pbs.length})`] : ['plan', 'Planificado'];
      return `<tr><td>A.${esc(id)}</td><td>${esc(ISO_CONTROLS[id])}</td><td>Sí</td><td class="note">${pbs.map((p) => esc(p.title)).join('; ')}</td><td><span class="pill ${st[0]}">${st[1]}</span></td></tr>`;
    })
    .join('');

  const lawMap = new Map<string, Playbook[]>();
  for (const pb of planned) for (const d of complianceFor(pb.id, pb.pillar).law) (lawMap.get(d.id) ?? lawMap.set(d.id, []).get(d.id)!).push(pb);
  const lawRows = [...lawMap.entries()]
    .map(([id, pbs]) => {
      const done = pbs.filter((p) => ctx.deployments[p.id]?.status === 'ok').length;
      return `<tr><td>${esc(LAW_DUTIES[id])}</td><td class="note">${pbs.map((p) => esc(p.title)).join('; ')}</td><td>${done}/${pbs.length} implementadas</td></tr>`;
    })
    .join('');

  const body = `
<h2>1. Declaración</h2>
<div class="box">${esc(ctx.org)} declara su compromiso de proteger la confidencialidad, integridad y disponibilidad de la información gestionada en Microsoft 365, y adopta la presente hoja de ruta de gobierno como plan formal de implementación de controles, basada en el Assessment realizado el ${ctx.assessmentAt ? fmtDate(ctx.assessmentAt) : '(sin fecha)'} y alineada con ISO/IEC 27001:2022 y la ${esc(LAW_NAME)}.</div>
<table><tr><th>Perfil de gobierno adoptado</th><td><b>${esc(rec.profile)}</b></td></tr>
<tr><th>Madurez actual</th><td>${rec.scores.overall}% (Entra ID ${rec.scores.pillars.entra ?? 'n/e'}% · Intune ${rec.scores.pillars.intune ?? 'n/e'}% · Defender ${rec.scores.pillars.defender ?? 'n/e'}% · Purview ${rec.scores.pillars.purview ?? 'n/e'}%)</td></tr>
<tr><th>Hallazgos</th><td>${sev('critica')} críticos · ${sev('alta')} altos · ${sev('media')} medios · ${sev('baja')} bajos</td></tr>
<tr><th>Acciones planificadas</th><td>${rec.items.length} playbooks en ${phaseDates.filter((p) => rec.items.some((i) => i.phase === p.phase)).length} fases, del ${fmtDate(start)} al ${fmtDate(phaseDates[phaseDates.length - 1].to)}</td></tr>
<tr><th>Fundamento del perfil</th><td class="note">${rec.profileReasons.map(esc).join('<br>')}</td></tr></table>
<h2>2. Hallazgos del Assessment</h2>
<table><tr><th style="width:9%">Severidad</th><th style="width:11%">Módulo</th><th>Hallazgo</th><th style="width:28%">Acción que lo resuelve</th></tr>${findings}</table>
<h2>3. Hoja de ruta y plan de despliegue</h2>
<p>Cada fase se despliega primero en DEV/POC, se valida y luego se promueve a producción con confirmación explícita y registro de evidencia. Las políticas de Acceso Condicional de alto impacto se habilitan inicialmente en modo "solo informe".</p>
${roadmap}
<h2>4. Declaración de aplicabilidad (SoA) — ISO/IEC 27001:2022</h2>
<p class="note">Controles del Anexo A implementados mediante la plataforma Microsoft 365 Business Premium. Los controles organizacionales, físicos y de personas no listados se gestionan fuera del alcance de esta plataforma y deben incorporarse a la SoA corporativa.</p>
<table><tr><th style="width:8%">Control</th><th style="width:28%">Nombre</th><th style="width:8%">Aplica</th><th>Justificación / implementación</th><th style="width:14%">Estado</th></tr>${soaRows}</table>
<h2>5. Matriz de cumplimiento — ${esc(LAW_NAME)}</h2>
<table><tr><th style="width:40%">Principio / deber</th><th>Medidas técnicas</th><th style="width:16%">Avance</th></tr>${lawRows}</table>
<h2>6. Gobierno del plan</h2>
<ul><li>Responsable de la ejecución: ${esc(ctx.author ?? '(definir)')}.</li><li>Cada acción cuenta con su procedimiento de ejecución (GOB-PRC) y cada módulo con su política (GOB-POL).</li>
<li>Los despliegues a producción generan un acta de evidencia (GOB-EVD) con el estado anterior y posterior de cada configuración, firmada con huella SHA-256.</li>
<li>El avance se mide con el módulo de métricas (antes/después de cada despliegue) y se revisa mensualmente.</li><li>El plan se revisa al menos una vez al año o ante cambios significativos.</li></ul>`;
  return layout({ code: 'GOB-DEC-01', title: 'Declaración de aplicabilidad y hoja de ruta de gobierno', subtitle: 'Plan de despliegue de seguridad Microsoft 365 Business Premium', ctx, body });
}

// ---------------------------------------------------------------------------
// 2. Política por módulo
// ---------------------------------------------------------------------------

export function renderPillarPolicy(pillar: Pillar, ctx: DocContext): string {
  const meta = PILLAR_POLICY[pillar];
  const pbs = PLAYBOOKS.filter((p) => p.pillar === pillar);
  const relevant = pbs.filter((p) => statusOf(p, ctx).cls !== 'muted');
  const list = relevant.length ? relevant : pbs;
  const statements = list
    .map((pb, n) => {
      const params = paramsOf(pb, ctx);
      const st = statusOf(pb, ctx);
      const values = pb.params.length
        ? `<ul>${pb.params.map((d) => `<li>${esc(d.label)}: <b>${esc(formatParam(d, params[d.key]))}</b></li>`).join('')}</ul>`
        : '';
      return `<h3>${pillar.toUpperCase()}-${String(n + 1).padStart(2, '0')}. ${esc(pb.title)} <span class="pill ${st.cls}">${esc(st.label)}</span></h3>
<p>${esc(pb.summary)} En consecuencia, la organización establece:</p><ul>${pb.changes.map((c) => `<li>${esc(c)}.</li>`).join('')}</ul>${values}
<p class="note">Procedimiento: GOB-PRC-${esc(pb.id.toUpperCase())} · Controles: ${complianceFor(pb.id, pb.pillar)
        .iso.map((c) => `A.${c.id}`)
        .join(', ')}</p>`;
    })
    .join('');
  const body = `
<h2>1. Objetivo</h2><p>${esc(meta.objective)}</p>
<h2>2. Alcance</h2><p>${esc(meta.scope)}</p>
<h2>3. Referencias normativas</h2>${complianceTable(list)}
<h2>4. Roles y responsabilidades</h2>
<table><tr><th style="width:30%">Rol</th><th>Responsabilidad</th></tr>
<tr><td>Dirección / Comité de seguridad</td><td>Aprueba la política y los riesgos residuales; asigna recursos.</td></tr>
<tr><td>Responsable de seguridad de la información</td><td>Mantiene la política, aprueba excepciones y revisa las métricas de cumplimiento.</td></tr>
<tr><td>Administradores de ${esc(PILLAR_NAME[pillar])}</td><td>Implementan y operan las configuraciones descritas, siguiendo los procedimientos GOB-PRC y registrando evidencia.</td></tr>
<tr><td>Usuarios</td><td>Cumplen la política y reportan incidentes o comportamientos anómalos.</td></tr></table>
<h2>5. Declaraciones de política</h2>${statements}
<h2>6. Excepciones</h2><p>Las excepciones deben solicitarse por escrito, justificarse, tener fecha de término y ser aprobadas por el Responsable de seguridad de la información. Las cuentas de acceso de emergencia están excluidas de las políticas de Acceso Condicional, se custodian bajo doble control y todo uso se registra y revisa.</p>
<h2>7. Cumplimiento, monitoreo y revisión</h2><p>El cumplimiento se verifica mediante el Assessment periódico y el módulo de métricas de Gobierno M365. Esta política se revisa al menos una vez al año o ante cambios significativos en la plataforma o la normativa.</p>
<h2>8. Control de cambios</h2><table><tr><th>Versión</th><th>Fecha</th><th>Descripción</th></tr><tr><td>1.0</td><td>${fmtDate(new Date())}</td><td>Emisión inicial generada a partir de la configuración ${esc(ctx.envName)}.</td></tr></table>`;
  return layout({ code: meta.code, title: meta.title, subtitle: `Módulo ${PILLAR_NAME[pillar]} · Microsoft 365 Business Premium`, ctx, body });
}

// ---------------------------------------------------------------------------
// 3. Procedimiento / política de ejecución por playbook
// ---------------------------------------------------------------------------

export function renderPlaybookProcedure(pb: Playbook, ctx: DocContext): string {
  const params = paramsOf(pb, ctx);
  const rec = ctx.recommendation?.items.find((i) => i.playbookId === pb.id);
  const findings = ctx.recommendation?.findings.filter((f) => f.playbooks.includes(pb.id)) ?? [];
  const deps = (typeof pb.dependsOn === 'function' ? pb.dependsOn(params) : pb.dependsOn ?? []).map((d) => getPlaybook(d)?.title ?? d);
  const tiles = pb.tiles.map((t) => TILES.find((x) => x.id === t)?.name ?? t);
  const st = statusOf(pb, ctx);
  const rollback =
    pb.engine === 'manual'
      ? 'Revertir manualmente en el portal los ajustes realizados, usando como referencia el registro de cambios.'
      : pb.engine === 'graph'
        ? 'Los objetos creados llevan el prefijo "GOB-" y pueden deshabilitarse o eliminarse desde el portal correspondiente. Para configuraciones del tenant modificadas, restaurar los valores "antes" registrados en el acta de evidencia (GOB-EVD) del despliegue. En Acceso Condicional, la primera medida de reversa es cambiar el estado a "Desactivada" o "Solo informe".'
        : 'Las políticas y reglas creadas llevan el prefijo "GOB-" y pueden deshabilitarse (Set-*Rule -State Disabled) o eliminarse (Remove-*) con el mismo módulo de PowerShell. Los ajustes de organización se restauran con los valores previos registrados en la evidencia.';
  const body = `
<table><tr><th style="width:26%">Módulo</th><td>${esc(PILLAR_NAME[pb.pillar])}</td></tr><tr><th>Capacidades del mapa</th><td>${tiles.map(esc).join(', ')}</td></tr>
<tr><th>Método de ejecución</th><td>${esc(ENGINE[pb.engine])}</td></tr><tr><th>Fase / prioridad</th><td>Fase ${pb.phase} · ${esc(PHASES[pb.phase].name)}${rec ? ` · ${rec.priority}` : ''}</td></tr>
<tr><th>Riesgo del cambio</th><td>${esc(pb.risk)}</td></tr><tr><th>Estado en ${esc(ctx.envName)}</th><td><span class="pill ${st.cls}">${esc(st.label)}</span></td></tr></table>
<h2>1. Objetivo</h2><p>${esc(pb.summary)}</p>
<h2>2. Justificación</h2>${
    findings.length
      ? `<ul>${findings.map((f) => `<li><b>[${esc(f.severity)}] ${esc(f.title)}</b>: ${esc(f.detail)}</li>`).join('')}</ul>`
      : `<p>${esc(rec?.reason ?? 'Control de la línea base de seguridad recomendada por Microsoft para Business Premium.')}</p>`
  }
<h2>3. Configuración a aplicar</h2><ul>${pb.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>${paramTable(pb, params)}
<h2>4. Impacto y comunicación</h2><p>${esc(pb.userImpact)}</p><p>Si el impacto no es nulo, comunicar a los usuarios afectados con al menos 3 días hábiles de anticipación.</p>
<h2>5. Prerrequisitos</h2><ul>${deps.length ? deps.map((d) => `<li>Ejecutado previamente: ${esc(d)}</li>`).join('') : '<li>Sin dependencias previas.</li>'}${(pb.manualSteps ?? []).map((s) => `<li>${esc(s.text)}</li>`).join('')}${pb.permissions.length ? `<li>Permisos Microsoft Graph: ${pb.permissions.map(esc).join(', ')}</li>` : ''}${(pb.extraRequirements ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
<h2>6. Procedimiento de ejecución</h2><ol>
<li>Verificar que la solicitud de cambio esté aprobada (sección Aprobaciones).</li>
<li>En Gobierno M365, seleccionar el ambiente DEV o POC, abrir la acción y revisar los parámetros de la sección 3.</li>
<li>Ejecutar "Previsualizar cambios" y confirmar que los objetos a crear/actualizar son los esperados.</li>
<li>Desplegar en DEV/POC, validar los criterios de aceptación y observar el impacto (${pb.id.startsWith('entra-ca') ? 'revisar registros de inicio de sesión en modo informe 7-14 días' : 'mínimo 48 horas'}).</li>
<li>Seleccionar el ambiente PRD, iniciar sesión como administrador con MFA, previsualizar y desplegar confirmando el nombre del ambiente.</li>
<li>Descargar el acta de evidencia generada (GOB-EVD) y archivarla junto a este procedimiento.</li></ol>
<h2>7. Criterios de aceptación</h2><ul><li>El despliegue termina con estado "completado" y sin errores.</li><li>Una nueva previsualización muestra "Sin cambios" para esta acción (configuración convergida).</li><li>El Assessment posterior refleja la mejora esperada en las métricas del módulo.</li><li>No se registran incidentes de acceso no previstos en las 48 horas siguientes.</li></ul>
<h2>8. Plan de reversa</h2><p>${esc(rollback)}</p>
<h2>9. Controles y obligaciones que cubre</h2>${complianceTable([pb])}
${pb.docsUrl ? `<p class="note">Referencia técnica: ${esc(pb.docsUrl)}</p>` : ''}`;
  return layout({ code: `GOB-PRC-${pb.id.toUpperCase()}`, title: `Procedimiento de ejecución: ${pb.title}`, subtitle: 'Política de ejecución de cambio', ctx, body });
}

// ---------------------------------------------------------------------------
// 4. Acta de evidencia de despliegue
// ---------------------------------------------------------------------------

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && depth < 5) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k.startsWith('@odata')) continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  } else if (prefix) {
    out[prefix] = obj;
  }
  return out;
}

const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

function evidenceRows(e: EvidenceEntry): string {
  if (e.method === 'SCRIPT') {
    const out = (e.after as any)?.salida as string[] | undefined;
    return `<p><b>${esc(e.resource)}</b> · ${fmtDateTime(e.at)}</p><p class="note">${esc(e.before)}</p><h3>Resultado reportado</h3><pre>${esc((out ?? []).join('\n') || '(sin salida)')}</pre>
<details><summary>Script ejecutado</summary><pre>${esc(e.request)}</pre></details>`;
  }
  const req = flatten(e.request);
  const before = flatten(e.before);
  const after = flatten(e.after);
  const keys = Object.keys(req).length ? Object.keys(req) : Object.keys({ ...before, ...after });
  const rows = keys
    .slice(0, 60)
    .map((k) => {
      const b = e.before === null ? '(no existía)' : show(before[k]);
      const a = e.after === undefined ? show(req[k]) : e.after === null ? '(eliminado)' : show(after[k]);
      return `<tr><td>${esc(k)}</td><td>${esc(b)}</td><td>${esc(a)}</td></tr>`;
    })
    .join('');
  const label = e.method === 'POST' ? (e.before === null ? 'Creación' : 'Acción') : e.method === 'DELETE' ? 'Eliminación' : 'Modificación';
  return `<p><b>${label}</b> · <code>${esc(e.resource)}</code> (${esc(e.api)}) · ${fmtDateTime(e.at)}</p>
<table><tr><th style="width:34%">Campo</th><th>Cómo estaba (antes)</th><th>Cómo quedó (después)</th></tr>${rows || '<tr><td colspan="3">Sin campos comparables</td></tr>'}</table>`;
}

export function renderEvidence(ev: { record: any; hash: string; valid: boolean }, ctx: DocContext): string {
  const r = ev.record;
  const results: ItemResult[] = r.results ?? [];
  const before: MetricValues = r.metrics?.before ?? {};
  const after: MetricValues = r.metrics?.after ?? {};
  const kpis = METRIC_DEFS.filter((d) => before[d.key] != null || after[d.key] != null)
    .map((d) => {
      const b = before[d.key];
      const a = after[d.key];
      const delta = a != null && b != null ? a - b : null;
      const good = delta === null || delta === 0 ? '' : (delta > 0) === d.higherIsBetter ? 'up' : 'down';
      return `<tr><td>${esc(d.label)}</td><td>${b ?? 'n/e'}${d.unit}</td><td>${a ?? 'n/e'}${d.unit}</td><td class="${good}">${delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}${d.unit}`}</td></tr>`;
    })
    .join('');
  const all = results.map((x) => getPlaybook(x.playbookId)).filter((p): p is Playbook => Boolean(p));
  const items = results
    .map((res, n) => {
      const pb = getPlaybook(res.playbookId);
      const c = pb ? complianceFor(pb.id, pb.pillar) : { iso: [], law: [] };
      const evs: EvidenceEntry[] = res.evidence ?? [];
      return `<h3>${n + 1}. ${esc(res.title)} <span class="pill ${res.status === 'ok' ? 'ok' : res.status === 'manual' ? 'warn' : 'err'}">${esc(res.status)}</span></h3>
<table><tr><th style="width:26%">Módulo</th><td>${pb ? esc(PILLAR_NAME[pb.pillar]) : ''} · ${pb ? esc(ENGINE[pb.engine]) : ''}</td></tr>
<tr><th>ISO/IEC 27001:2022</th><td>${c.iso.map((x) => `A.${esc(x.id)} ${esc(x.name)}`).join('<br>')}</td></tr>
<tr><th>Ley 21.719</th><td>${c.law.map((x) => esc(x.name)).join('<br>')}</td></tr>
${res.error ? `<tr><th>Observación</th><td>${esc(res.error)}</td></tr>` : ''}
<tr><th>Resumen</th><td>${res.steps.map((s) => `${esc(s.action)}: ${esc(s.target)}`).join('<br>') || '—'}</td></tr></table>
${evs.length ? evs.map(evidenceRows).join('') : '<p class="note">Sin escrituras: la configuración ya estaba conforme (sin cambios).</p>'}`;
    })
    .join('');
  const body = `
<div class="box">Acta que deja constancia de los cambios de configuración aplicados en el tenant de Microsoft 365, indicando para cada recurso su estado anterior y posterior, y los controles de ISO/IEC 27001:2022 y deberes de la ${esc(LAW_NAME)} que fundamentan cada cambio (control A.5.28 Recolección de evidencia; A.8.32 Gestión de cambios).</div>
<table><tr><th style="width:28%">Identificador del despliegue</th><td>${esc(r.jobId)}</td></tr>
<tr><th>Ambiente</th><td>${esc(r.environment?.name)} (${esc(String(r.environment?.tier ?? '').toUpperCase())})${r.environment?.tenantId ? ` · tenant ${esc(r.environment.tenantId)}` : ''}</td></tr>
<tr><th>Dominio</th><td>${esc(r.tenant?.defaultDomain ?? r.tenant?.initialDomain ?? '')}</td></tr>
<tr><th>Ejecutado por</th><td>${esc(r.account ?? '(registro de aplicación / simulación)')}${r.account ? ' · autenticado con MFA' : ''}</td></tr>
<tr><th>Inicio / término</th><td>${fmtDateTime(r.startedAt)} → ${fmtDateTime(r.finishedAt)}</td></tr>
<tr><th>Resultado</th><td>${esc(r.status)} · ${results.filter((x) => x.status === 'ok').length} de ${results.length} acciones correctas</td></tr>
<tr><th>Integridad (SHA-256)</th><td><code>${esc(ev.hash)}</code> ${ev.valid ? '<span class="pill ok">verificada</span>' : '<span class="pill err">NO coincide: el archivo fue modificado</span>'}</td></tr></table>
<h2>1. Métricas antes y después</h2>${kpis ? `<table><tr><th>Indicador</th><th>Antes</th><th>Después</th><th>Variación</th></tr>${kpis}</table>` : '<p class="note">Métricas no disponibles.</p>'}
<h2>2. Controles y obligaciones cubiertos</h2>${complianceTable(all)}
<h2>3. Detalle de cambios (estado anterior → posterior)</h2>${items}`;
  return layout({ code: `GOB-EVD-${String(r.jobId).slice(0, 8).toUpperCase()}`, title: 'Acta de evidencia de despliegue', subtitle: `${r.environment?.name ?? ''} · ${fmtDateTime(r.finishedAt)}`, ctx, body });
}
