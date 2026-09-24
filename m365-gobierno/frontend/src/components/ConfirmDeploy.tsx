import { useState } from 'react';
import { signInWithMicrosoft } from '../api';
import { useApp } from '../store';
import { TIER_LABEL } from '../types';

/**
 * Confirmación antes de aplicar cambios. Producción exige escribir el nombre del ambiente y
 * advierte si algún playbook no se desplegó antes con éxito en DEV/POC.
 */
export function ConfirmDeploy({
  playbookIds,
  onConfirm,
  onCancel,
}: {
  playbookIds: string[];
  onConfirm: (confirmText: string) => void;
  onCancel: () => void;
}) {
  const { state, status, playbook } = useApp();
  const env = state.environment;
  const sim = env.kind === 'simulacion';
  const prd = env.tier === 'prd';
  const [ack, setAck] = useState(sim);
  const [typed, setTyped] = useState('');
  const notValidated = prd ? playbookIds.filter((id) => !state.validatedInLower[id]) : [];
  const [skipValidation, setSkipValidation] = useState(false);
  const tenant = status?.tenant?.defaultDomain ?? status?.tenant?.initialDomain ?? env.tenantId;
  const ready = ack && (!prd || typed.trim() === env.name) && (notValidated.length === 0 || skipValidation);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal small-modal">
        <h2 id="confirm-title">
          {sim ? 'Desplegar en el tenant simulado' : (
            <>
              Desplegar en <span className={`tier t-${env.tier}`}>{TIER_LABEL[env.tier]}</span> {env.name}
            </>
          )}
        </h2>
        <p>
          Se ejecutarán <b>{playbookIds.length}</b> playbooks (más sus dependencias). Son idempotentes: si la configuración ya existe, solo se
          actualiza lo que difiera.
        </p>

        {env.kind === 'delegado' && !env.connected ? (
          <div className="warn-card card small">
            No hay sesión de administrador en {env.name}.{' '}
            <button className="btn primary small-btn" onClick={() => signInWithMicrosoft(env.id)}>
              Iniciar sesión con Microsoft (contraseña + MFA)
            </button>
          </div>
        ) : (
          <>
            {env.kind === 'delegado' && (
              <p className="small">
                Se aplicará con la sesión de <b>{env.session?.account}</b>, validada con MFA en Microsoft.
              </p>
            )}
            {notValidated.length > 0 && (
              <div className="warn-card card small">
                <b>No validados en DEV/POC:</b>
                <ul className="bullets">
                  {notValidated.map((id) => (
                    <li key={id}>{playbook(id)?.title ?? id}</li>
                  ))}
                </ul>
                <label className="ack">
                  <input type="checkbox" checked={skipValidation} onChange={(e) => setSkipValidation(e.target.checked)} />
                  Asumo desplegarlos en producción sin haberlos probado antes en DEV/POC.
                </label>
              </div>
            )}
            {!sim && (
              <label className="ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  Entiendo que se aplicarán cambios en <b>{tenant}</b> y revisé la previsualización.
                </span>
              </label>
            )}
            {prd && (
              <label className="confirm-type">
                Escribe <code>{env.name}</code> para confirmar
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            )}
            {sim && <p className="muted small">Modo simulación: no se toca ningún tenant real.</p>}
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!ready || (env.kind === 'delegado' && !env.connected)} onClick={() => onConfirm(typed.trim())}>
            Desplegar
          </button>
        </div>
      </div>
    </div>
  );
}
