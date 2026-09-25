import type { Assessment } from '../types';
import { PeopleMfa } from './PeopleMfa';

/** Lo que la aplicación leyó realmente del tenant, para contrastarlo con los portales de Microsoft. */
export function TenantData({ a }: { a: Assessment }) {
  const scan = a.scan ?? {};
  const probe = scan.probe;
  const cats: Record<string, { score: number; max: number; pct: number }> = scan.secureScore?.categories ?? {};
  const controls: { title: string; category: string; score: number; max: number }[] = scan.secureScore?.controls ?? [];
  return (
    <div className="card">
      <h2>Datos leídos del tenant</h2>
      <p className="small muted">
        Lectura del {new Date(scan.at ?? a.at).toLocaleString('es-CL')}. Compáralos con los portales de Microsoft para validar la información.
      </p>
      {Array.isArray(scan.quality) && scan.quality.length > 0 && (
        <div className="quality">
          <h3>Control de calidad de los datos</h3>
          <ul>
            {scan.quality.map((q: any) => (
              <li key={q.id} className={`q-${q.status}`}>
                <span className="q-icon" aria-hidden>
                  {q.status === 'warn' ? '⚠' : q.status === 'ok' ? '✓' : 'ℹ'}
                </span>
                <div>
                  <b>{q.label}.</b> {q.detail}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(scan.mfaUsers) && (
        <details className="people-details" open>
          <summary>
            Personas y MFA ({scan.mfaUsers.length} personas{scan.signIns ? ` · inicios de sesión de los últimos ${scan.signIns.days} días` : ''})
          </summary>
          <p className="small muted">
            "MFA registrado" viene del informe de Microsoft; "Con MFA exigido" cuenta los inicios de sesión exitosos en que se pidió MFA. Una persona puede tener
            MFA registrado y aun así iniciar sesión sin que se le pida.
          </p>
          <PeopleMfa people={scan.mfaUsers} days={scan.signIns?.days} />
        </details>
      )}
      <div className="data-grid">
        <section>
          <h3>Secure Score por categoría</h3>
          {Object.keys(cats).length ? (
            <ul className="kv">
              {Object.entries(cats).map(([k, v]) => (
                <li key={k}>
                  <span>{k}</span>
                  <b>
                    {v.pct}% <span className="muted small">({Math.round(v.score)}/{Math.round(v.max)})</span>
                  </b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Sin detalle por categoría.</p>
          )}
        </section>
        <section>
          <h3>DLP, etiquetas y retención (Purview)</h3>
          {probe?.ipps ? (
            <ul className="kv">
              <li>
                <span>Directivas DLP</span>
                <b>{probe.ipps.dlpPolicies?.length ?? 'n/e'}</b>
              </li>
              {(probe.ipps.dlpPolicies ?? []).map((p: any) => (
                <li key={p.Name} className="sub">
                  <span>{p.Name}</span>
                  <span className="small">{p.Mode}{p.Enabled === false ? ' · deshabilitada' : ''}</span>
                </li>
              ))}
              <li>
                <span>Etiquetas de confidencialidad</span>
                <b>{probe.ipps.labels?.length ?? 'n/e'}</b>
              </li>
              <li>
                <span>Directivas de retención</span>
                <b>{probe.ipps.retentionPolicies?.length ?? 'n/e'}</b>
              </li>
            </ul>
          ) : (
            <p className="small warn-text">No se pudo leer Purview por PowerShell (ver áreas no evaluadas).</p>
          )}
          {scan.sensitivityLabels && <p className="small">Etiquetas vía Graph: {scan.sensitivityLabels.join(', ') || 'ninguna'}</p>}
        </section>
        <section>
          <h3>Correo (Defender for Office 365)</h3>
          {probe?.exo ? (
            <ul className="kv">
              <li>
                <span>Auditoría unificada</span>
                <b>{probe.exo.auditEnabled === undefined ? 'n/e' : probe.exo.auditEnabled ? 'Activa' : 'Inactiva'}</b>
              </li>
              <li>
                <span>Reglas Safe Links activas</span>
                <b>{(probe.exo.safeLinksRules ?? []).filter((r: any) => r.State === 'Enabled').length}</b>
              </li>
              <li>
                <span>Reglas Safe Attachments activas</span>
                <b>{(probe.exo.safeAttachmentRules ?? []).filter((r: any) => r.State === 'Enabled').length}</b>
              </li>
              <li>
                <span>Directivas preestablecidas activas</span>
                <b>{(probe.exo.presetRules ?? []).filter((r: any) => r.State === 'Enabled').length}</b>
              </li>
              <li>
                <span>Reenvío automático externo</span>
                <b>{probe.exo.autoForwardingMode ?? 'n/e'}</b>
              </li>
              <li>
                <span>SMTP AUTH deshabilitado</span>
                <b>{probe.exo.smtpAuthDisabled === undefined ? 'n/e' : probe.exo.smtpAuthDisabled ? 'Sí' : 'No'}</b>
              </li>
            </ul>
          ) : (
            <p className="small warn-text">No se pudo leer Exchange Online por PowerShell (ver áreas no evaluadas).</p>
          )}
        </section>
      </div>
      {controls.length > 0 && (
        <details>
          <summary>Controles de Secure Score ({controls.length})</summary>
          <div className="table-scroll">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Categoría</th>
                  <th>Puntos</th>
                </tr>
              </thead>
              <tbody>
                {[...controls]
                  .sort((x, y) => x.category.localeCompare(y.category) || y.max - y.score - (x.max - x.score))
                  .map((c) => (
                    <tr key={c.title}>
                      <td>{c.title}</td>
                      <td>{c.category}</td>
                      <td>
                        {Math.round(c.score * 10) / 10} / {c.max}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details>
        <summary>Datos crudos (JSON)</summary>
        <pre className="code">{JSON.stringify(scan, null, 2)}</pre>
      </details>
    </div>
  );
}
