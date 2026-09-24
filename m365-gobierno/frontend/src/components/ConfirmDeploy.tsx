import { useState } from 'react';
import { useApp } from '../store';

/** Confirmación antes de aplicar cambios. En modo real exige reconocer el tenant destino. */
export function ConfirmDeploy({ count, onConfirm, onCancel }: { count: number; onConfirm: () => void; onCancel: () => void }) {
  const { status } = useApp();
  const real = status?.mode === 'real';
  const [ack, setAck] = useState(!real);
  const tenant = status?.tenant?.defaultDomain ?? status?.tenant?.initialDomain ?? status?.tenantId;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal small-modal">
        <h2 id="confirm-title">{real ? 'Aplicar en el tenant real' : 'Desplegar en el tenant simulado'}</h2>
        <p>
          Se ejecutarán <b>{count}</b> playbooks (más sus dependencias). Cada uno es idempotente: si la configuración ya existe, solo se
          actualiza lo que difiera.
        </p>
        {real ? (
          <label className="ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que se aplicarán cambios en <b>{tenant}</b> y revisé la previsualización.
          </label>
        ) : (
          <p className="muted small">Modo simulación: no se toca ningún tenant real. Configura las credenciales en backend/.env para operar en producción.</p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!ack} onClick={onConfirm}>
            Desplegar
          </button>
        </div>
      </div>
    </div>
  );
}
