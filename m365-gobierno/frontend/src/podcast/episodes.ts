import type { Catalog, Tile } from '../types';
import { EXPLAIN, HOSTS, PRODUCTIVITY } from './content';

export type Speaker = 'A' | 'B';
export interface Line {
  speaker: Speaker;
  text: string;
  tileId?: string;
}
export interface Episode {
  id: string;
  number: number;
  title: string;
  summary: string;
  lines: Line[];
  tiles: string[];
}

const PLAN: { id: string; title: string; summary: string; intro: string[]; tiles: string[] }[] = [
  {
    id: 'bienvenida',
    title: 'Bienvenida: la licencia y sus cuatro pilares',
    summary: 'Qué trae Microsoft 365 Business Premium y cómo leer el mapa.',
    intro: [],
    tiles: [],
  },
  {
    id: 'identidad-acceso',
    title: 'Identidad I: quién entra y cómo (Entra ID)',
    summary: 'MFA, Acceso Condicional, sin contraseña y recuperación de cuentas.',
    intro: ['Empezamos por el pilar más importante: la identidad. Si alguien roba una cuenta, todo lo demás da lo mismo.'],
    tiles: ['mfa', 'conditional-access', 'passwordless', 'temporary-access-pass', 'sms-sign-in', 'third-party-mfa', 'password-protection', 'sspr', 'self-service-activity-reports'],
  },
  {
    id: 'identidad-gobierno',
    title: 'Identidad II: el gobierno del directorio (Entra ID)',
    summary: 'Permisos de usuarios, grupos, invitados, aplicaciones y controles avanzados.',
    intro: ['Seguimos con Entra ID, pero ahora con el orden de la casa: quién puede crear qué, cómo se agrupan las personas y cómo se conectan otras aplicaciones.'],
    tiles: [
      'self-service-group-management',
      'dynamic-groups',
      'administrative-units',
      'custom-security-attributes',
      'customized-sign-in',
      'external-id',
      'sso-saas',
      'shared-password-rollover',
      'app-proxy',
      'cloud-app-discovery',
      'advanced-security-reports',
      'connect-health',
      'mim',
      'enterprise-state-roaming',
      'internet-access-microsoft',
      'tenant-restrictions',
      'terms-of-use',
      'verified-id',
      'agent-id',
      'sla',
    ],
  },
  {
    id: 'dispositivos',
    title: 'Dispositivos: Intune, Autopilot y Windows Pro',
    summary: 'Cómo se administran, cifran y actualizan los equipos y celulares.',
    intro: ['Ahora pasamos a los equipos. La pregunta clave es: ¿desde qué dispositivo se accede a la información, y está sano?'],
    tiles: [
      'windows-autopilot-ems',
      'device-management',
      'application-management',
      'entra-id-join',
      'manage-by-mdm',
      'domain-join',
      'bitlocker',
      'bitlocker-to-go',
      'laps',
      'windows-firewall',
      'windows-hello',
      'windows-conditional-access',
      'windows-update-business',
      'windows-autopatch',
      'windows-11-support',
      'endpoint-analytics',
      'edge-business',
      'assigned-access',
      'unbranded-boot',
      'universal-print',
      'windows-virtualization',
      'pad-flows',
    ],
  },
  {
    id: 'defender-equipos',
    title: 'Amenazas en los equipos: Defender for Business',
    summary: 'Antivirus de nueva generación, reglas contra ransomware y respuesta ante incidentes.',
    intro: ['Tercer pilar: Defender. Primero en los computadores y celulares, donde se juega la batalla contra el malware y el ransomware.'],
    tiles: [
      'defender-antivirus',
      'next-gen-protection',
      'block-at-first-sight',
      'attack-surface-reduction',
      'application-control',
      'applocker',
      'edr',
      'automated-investigations',
      'tamper-protection',
      'web-content-filtering',
      'vulnerability-management',
      'threat-analytics',
      'centralized-management',
      'cross-platform',
      'mobile-threat-defence',
    ],
  },
  {
    id: 'correo',
    title: 'El correo seguro: Exchange y Defender for Office 365',
    summary: 'Phishing, enlaces y adjuntos maliciosos, suplantación y reenvíos.',
    intro: ['El correo sigue siendo la puerta de entrada número uno de los ataques. Veamos cómo se protege.'],
    tiles: ['exchange-online', 'exchange-online-protection', 'safe-links', 'safe-attachments', 'advanced-anti-phishing', 'real-time-reports', 'message-encryption'],
  },
  {
    id: 'datos',
    title: 'Los datos: Purview, cumplimiento y colaboración',
    summary: 'Clasificación, DLP, auditoría, retención y uso compartido; la base para la Ley 21.719.',
    intro: ['Cuarto pilar: la información. Aquí está lo que más se relaciona con la ley de protección de datos personales.'],
    tiles: [
      'information-protection',
      'information-protection-m365',
      'dlp',
      'audit-standard',
      'alert-policies',
      'activity-reports',
      'exchange-online-archiving',
      'ediscovery-standard',
      'content-search',
      'compliance-manager',
      'sharepoint-online',
      'onedrive',
      'teams-essentials',
      'loop-workspaces',
      'copilot-basic',
      'secure-score',
      'basic-mobility-security',
    ],
  },
  {
    id: 'productividad',
    title: 'Productividad y cierre',
    summary: 'Las herramientas de trabajo incluidas en la licencia y cómo seguir.',
    intro: ['Para cerrar, un recorrido rápido por las herramientas de productividad. No son de seguridad, pero heredan todo lo que vimos.'],
    tiles: ['m365-apps-business', 'm365-mobile-app', ...PRODUCTIVITY, 'fasttrack'],
  },
];

const ASK = [
  (n: string) => `Siguiente caja: ${n}. ¿Qué es?`,
  (n: string) => `Vamos con ${n}. ¿Para qué sirve?`,
  (n: string) => `¿Y ${n}?`,
  (n: string) => `Ahora ${n}. Explícamelo simple.`,
  (n: string) => `Cuéntame de ${n}.`,
];
const EXAMPLE = ['¿Un ejemplo concreto?', '¿Cómo se ve eso en el día a día?', '¿Me das un caso?', 'Aterricémoslo.'];

function appLine(catalog: Catalog, tile: Tile): string {
  const pbs = catalog.playbooks.filter((p) => p.tiles.includes(tile.id));
  if (!pbs.length) return 'Viene incluida en la licencia y no requiere configuración de seguridad desde la aplicación.';
  const auto = pbs.filter((p) => p.engine !== 'manual');
  const manual = pbs.filter((p) => p.engine === 'manual');
  const parts: string[] = [];
  if (auto.length) {
    const names = auto.slice(0, 3).map((p) => p.title.replace(/^CA\d+ · /, ''));
    parts.push(`En Gobierno M365 se configura automáticamente con ${names.join(', ')}${auto.length > 3 ? ` y ${auto.length - 3} más` : ''}, en la fase ${Math.min(...auto.map((p) => p.phase))} de la hoja de ruta.`);
  }
  if (manual.length) parts.push(`${auto.length ? 'Además, una' : 'Microsoft no permite activarla por API, así que la'} aplicación te entrega el paso a paso en el portal.`);
  return parts.join(' ');
}

export function buildEpisodes(catalog: Catalog): Episode[] {
  const byId = new Map(catalog.tiles.map((t) => [t.id, t]));
  const planned = new Set(PLAN.flatMap((p) => p.tiles));
  // Garantiza que ninguna caja del mapa quede fuera del podcast
  const leftovers = catalog.tiles.map((t) => t.id).filter((id) => !planned.has(id));
  let q = 0;
  const episodes = PLAN.map((p, i): Episode => {
    const tiles = [...p.tiles, ...(i === PLAN.length - 1 ? leftovers : [])].filter((id) => byId.has(id));
    const lines: Line[] = [];
    if (p.id === 'bienvenida') {
      lines.push(
        { speaker: 'A', text: `Hola, soy ${HOSTS.A}. Bienvenidos a "El mapa de Business Premium, caja por caja", el podcast para entender qué trae la licencia y para qué sirve cada pieza.` },
        { speaker: 'B', text: `Y yo soy ${HOSTS.B}. Mi trabajo es traducir el idioma de Microsoft a lo que pasa en una empresa real.` },
        { speaker: 'A', text: 'Martín, partamos por lo básico. ¿Qué es Microsoft 365 Business Premium?' },
        { speaker: 'B', text: 'Es la licencia pensada para empresas de hasta 300 personas. Junta tres cosas: Office 365, que es correo, Teams y documentos; Enterprise Mobility más Security, que es identidad y administración de equipos; y Windows Pro con Defender for Business, que protege los computadores.' },
        { speaker: 'A', text: '¿Y cómo leo el mapa?' },
        { speaker: 'B', text: 'Cada caja es una capacidad. Las rojas son Office 365, las azules son Entra ID, las celestes Intune, las verdes Windows y Defender, y las naranjas la protección avanzada del correo. En la aplicación, cada caja se abre y se puede activar.' },
        { speaker: 'A', text: 'Hablaste de pilares. ¿Cuáles son?' },
        { speaker: 'B', text: 'Son cuatro. Entra ID, que responde quién eres y si te dejo entrar. Intune, que responde desde qué equipo y si está sano. Defender, que protege contra ataques en el correo y en los equipos. Y Purview, que protege la información: la clasifica, evita que se filtre y deja registro.' },
        { speaker: 'A', text: 'Un consejo antes de empezar.' },
        { speaker: 'B', text: 'Que tener la licencia no es lo mismo que estar protegido. La mayoría de estas capacidades vienen apagadas o con valores por defecto. El valor está en configurarlas bien, y en ese orden vamos a ir en los próximos episodios.' },
      );
    } else {
      lines.push({ speaker: 'A', text: `Episodio ${i}: ${p.title}.` }, ...p.intro.map((t) => ({ speaker: 'B' as const, text: t })));
      const quick = p.id === 'productividad' ? new Set(PRODUCTIVITY.concat(leftovers)) : new Set<string>();
      const quickTiles = tiles.filter((id) => quick.has(id) && !EXPLAIN[id]);
      for (const id of tiles.filter((x) => !quickTiles.includes(x))) {
        const t = byId.get(id)!;
        const ex = EXPLAIN[id] ?? { a: t.description };
        lines.push({ speaker: 'A', text: ASK[q++ % ASK.length](t.name), tileId: id });
        lines.push({ speaker: 'B', text: ex.a, tileId: id });
        if (ex.ej) {
          lines.push({ speaker: 'A', text: EXAMPLE[q % EXAMPLE.length], tileId: id });
          lines.push({ speaker: 'B', text: ex.ej, tileId: id });
        }
        lines.push({ speaker: 'B', text: appLine(catalog, t), tileId: id });
      }
      if (quickTiles.length) {
        lines.push({ speaker: 'A', text: 'Hagamos una ronda rápida por el resto de las herramientas.' });
        for (const id of quickTiles) {
          const t = byId.get(id)!;
          lines.push({ speaker: 'B', text: `${t.name}: ${t.description}`, tileId: id });
        }
      }
      if (p.id === 'productividad') {
        lines.push(
          { speaker: 'A', text: 'Martín, para cerrar la serie, ¿por dónde parte una empresa?' },
          { speaker: 'B', text: 'Por el Assessment de la aplicación, que lee el tenant y dice dónde estás. Luego la fase cero y uno: cuentas de emergencia, MFA para todos, bloquear la autenticación antigua y proteger el correo. Con eso ya se cierra la mayoría de los ataques.' },
          { speaker: 'A', text: 'Y siempre probando antes, ¿cierto?' },
          { speaker: 'B', text: 'Siempre. Primero en modo informe o en un ambiente de prueba, se revisa el impacto y recién ahí se aplica en producción, dejando evidencia de cómo estaba y cómo quedó.' },
          { speaker: 'A', text: `Gracias por escuchar. Soy ${HOSTS.A}.` },
          { speaker: 'B', text: `Y yo ${HOSTS.B}. Nos escuchamos en el mapa.` },
        );
      } else {
        lines.push({ speaker: 'A', text: 'Hasta aquí este episodio. En el siguiente seguimos recorriendo el mapa.' });
      }
    }
    return { id: p.id, number: i, title: p.title, summary: p.summary, lines, tiles };
  });
  return episodes;
}

export function transcript(episodes: Episode[]): string {
  return episodes
    .map((e) => [`EPISODIO ${e.number}: ${e.title}`, e.summary, '', ...e.lines.map((l) => `${HOSTS[l.speaker]}: ${l.text}`), ''].join('\n'))
    .join('\n');
}

/** Script de PowerShell que genera un .wav por episodio con las voces instaladas en Windows (sin internet). */
export function audioScript(episodes: Episode[]): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const eps = episodes
    .map(
      (e) => `  @{ File = ${q(`podcast-${String(e.number).padStart(2, '0')}-${e.id}.wav`)}; Lines = @(
${e.lines.map((l) => `    @(${q(l.speaker)}, ${q(l.text)})`).join(',\n')}
  ) }`,
    )
    .join(',\n');
  return `﻿# Podcast "El mapa de Business Premium, caja por caja" — genera un archivo .wav por episodio
# Uso: powershell -ExecutionPolicy Bypass -File .\\podcast-m365.ps1
# Usa las voces en español instaladas en Windows (Configuración > Hora e idioma > Voz). No requiere internet.
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'es*' } | ForEach-Object { $_.VoiceInfo.Name })
if ($voices.Count -eq 0) { Write-Warning 'No hay voces en español instaladas; se usará la voz predeterminada.'; $voices = @($synth.Voice.Name) }
$voiceA = $voices[0]
$voiceB = if ($voices.Count -gt 1) { $voices[1] } else { $voices[0] }
Write-Host "Voces: $voiceA / $voiceB"
$out = Join-Path (Get-Location) 'podcast-m365'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$episodes = @(
${eps}
)
foreach ($ep in $episodes) {
  $file = Join-Path $out $ep.File
  $synth.SetOutputToWaveFile($file)
  foreach ($line in $ep.Lines) {
    $synth.SelectVoice($(if ($line[0] -eq 'A') { $voiceA } else { $voiceB }))
    $synth.Speak($line[1])
  }
  $synth.SetOutputToNull()
  Write-Host "Generado: $file"
}
$synth.Dispose()
Write-Host "Listo. Los episodios están en $out"
`;
}
