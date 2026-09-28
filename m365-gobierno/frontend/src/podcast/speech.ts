import type { Line, Speaker } from './episodes';

/** Voces del navegador (Windows/Edge traen voces en español; Edge incluye voces "naturales"). */
export function spanishVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const all = speechSynthesis.getVoices();
  const es = all.filter((v) => v.lang.toLowerCase().startsWith('es'));
  // Primero las voces naturales / en línea, que suenan mucho mejor
  return es.sort((a, b) => Number(/natural|online/i.test(b.name)) - Number(/natural|online/i.test(a.name)));
}

export interface PlayOptions {
  voices: Record<Speaker, SpeechSynthesisVoice | undefined>;
  rate: number;
  onLine: (index: number) => void;
  onEnd: () => void;
}

/** Reproduce las líneas una a una (evita el corte de utterances largas en Chrome/Edge). */
export function playLines(lines: Line[], start: number, o: PlayOptions): () => void {
  let cancelled = false;
  const speakAt = (i: number) => {
    if (cancelled) return;
    if (i >= lines.length) return o.onEnd();
    o.onLine(i);
    const u = new SpeechSynthesisUtterance(lines[i].text);
    const v = o.voices[lines[i].speaker];
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = 'es-CL';
    u.rate = o.rate;
    u.pitch = lines[i].speaker === 'A' ? 1.05 : 0.95;
    u.onend = () => speakAt(i + 1);
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') speakAt(i + 1);
    };
    speechSynthesis.speak(u);
  };
  speechSynthesis.cancel();
  speakAt(start);
  return () => {
    cancelled = true;
    speechSynthesis.cancel();
  };
}
