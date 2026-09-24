import type { ParamDef, Params } from '../types';

export function ParamForm({ defs, values, onChange, idPrefix }: { defs: ParamDef[]; values: Params; onChange: (v: Params) => void; idPrefix: string }) {
  if (!defs.length) return <p className="muted small">Sin parámetros: se aplica la configuración recomendada por Microsoft.</p>;
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="param-form">
      {defs.map((d) => {
        const id = `${idPrefix}-${d.key}`;
        const v = values[d.key] ?? d.default;
        let input;
        switch (d.type) {
          case 'boolean':
            input = (
              <label className="switch">
                <input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => set(d.key, e.target.checked)} />
                <span>{v ? 'Sí' : 'No'}</span>
              </label>
            );
            break;
          case 'number':
            input = <input id={id} type="number" min={d.min} max={d.max} value={Number(v)} onChange={(e) => set(d.key, Number(e.target.value))} />;
            break;
          case 'select':
            input = (
              <select id={id} value={String(v)} onChange={(e) => set(d.key, e.target.value)}>
                {d.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case 'multiselect': {
            const arr = Array.isArray(v) ? (v as string[]) : [];
            input = (
              <div className="checks" id={id}>
                {d.options?.map((o) => (
                  <label key={o.value}>
                    <input
                      type="checkbox"
                      checked={arr.includes(o.value)}
                      onChange={(e) => set(d.key, e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            );
            break;
          }
          case 'list':
            input = (
              <textarea
                id={id}
                rows={3}
                value={Array.isArray(v) ? (v as string[]).join('\n') : String(v ?? '')}
                onChange={(e) => set(d.key, e.target.value.split('\n'))}
              />
            );
            break;
          default:
            input = <input id={id} type="text" value={String(v ?? '')} onChange={(e) => set(d.key, e.target.value)} />;
        }
        return (
          <div className="param" key={d.key}>
            <label htmlFor={id}>{d.label}</label>
            {input}
            {d.help && <small className="muted">{d.help}</small>}
          </div>
        );
      })}
    </div>
  );
}

/** Limpia listas (líneas vacías) antes de enviar. */
export function cleanParams(defs: ParamDef[], values: Params): Params {
  const out: Params = {};
  for (const d of defs) {
    const v = values[d.key] ?? d.default;
    out[d.key] = d.type === 'list' && Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : v;
  }
  return out;
}
