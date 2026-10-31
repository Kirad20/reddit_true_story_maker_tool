# TrueStoryMaker — diseño

Herramienta personal y local que convierte un post de Reddit en un video vertical
(1080×1920) con voz TTS, subtítulos palabra por palabra y fondo de gameplay.
Inspirada en la herramienta "Reddit Post to Video" de revid.ai (analizada con REA y
en una sesión real), con marca y código propios.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Uso | Personal, local, sin cuentas ni créditos |
| Voz | Kokoro (local, gratis) vía `kokoro-onnx`; tiempos por palabra con `faster-whisper` alineado al guion; respaldo proporcional por caracteres |
| Guion | Literal (por defecto) o reescrito con Claude; idioma EN o traducción a ES |
| Interfaz | Web local (React + Vite) |
| Render | Remotion (Node) |

## Arquitectura

```
apps/web        React + Vite. Formulario, progreso (SSE), preview con @remotion/player
apps/api        Node + TypeScript. Orquesta jobs, Reddit, Claude, TTS, render
packages/video  Composición Remotion compartida por web (preview) y api (render)
services/tts    Python 3.12 (uv) + FastAPI. Kokoro → WAV + palabras con tiempos
assets/         backgrounds/<categoría>/*.mp4, music/*.mp3 (los pone el usuario)
jobs/<id>/      job.json, composition.json, voice.wav, final.mp4
```

Sin base de datos: el estado de cada job vive en `jobs/<id>/job.json`.

## Pipeline

1. **Reddit**: `GET <url>.json` → título, cuerpo, subreddit, autor, upvotes y los N
   comentarios top (sin borrados, sin bots, con largo máximo). Alternativa: texto pegado.
2. **Guion**: bloques `{kind: title|post|comment, text, author}`. Limpieza literal
   (links, markdown, expansión de siglas). Modo Claude: reescritura con gancho y/o
   traducción al español, salida JSON. Si Claude falla, se usa el literal y se avisa.
   Tope de duración aproximado (por defecto 90 s) recortando comentarios.
3. **TTS**: un WAV por bloque + palabras con tiempos; se concatenan con pausa corta.
4. **Composición** (contrato con Remotion):

```ts
type VideoComposition = {
  fps: 30; width: 1080; height: 1920; durationInFrames: number;
  audio: { src: string; durationSec: number };
  music: { src: string; volume: number } | null;
  background: { kind: "video"; src: string; startAt: number } | { kind: "procedural"; preset: string };
  post: { subreddit: string; author: string; title: string; upvotes: number; comments: number };
  scenes: { kind: "title" | "post" | "comment"; text: string; author?: string; start: number; end: number }[];
  words: { text: string; start: number; end: number }[];
  captionStyle: "pop" | "karaoke" | "boxed";
};
```

5. **Render**: capas = fondo (clip con offset aleatorio en bucle, o fondo procedural si
   no hay clips) → tarjeta del post de Reddit durante la escena del título →
   subtítulos (1–3 palabras, palabra activa resaltada) → voz + música opcional.

Progreso del job: `queued → fetching → scripting → tts → composing → ready` (preview
disponible) y luego `rendering (n%) → done`. Errores dejan el job en `failed` con
mensaje; se puede reintentar.

## Interfaz

Una página: formulario a la izquierda (URL o texto, nº comentarios, modo de guion,
idioma, voz, fondo, estilo de subtítulos, música); a la derecha progreso, preview en
vivo con Remotion Player (cambiar estilo/fondo sin regenerar voz) y botón "Renderizar
MP4" + descarga. Debajo, lista de videos anteriores.

## Fuera del MVP

Editor de línea de tiempo, chat de edición, imágenes IA/stock, publicar en redes,
jobs en paralelo, partir en partes.

## Pruebas

- Vitest: parser de Reddit (fixture JSON), limpieza del guion, armado de la composición,
  alineación de palabras.
- pytest: el endpoint TTS devuelve palabras ordenadas y no superpuestas.
- Humo extremo a extremo: fixture de post sin red → MP4 1080×1920 con la duración esperada.
