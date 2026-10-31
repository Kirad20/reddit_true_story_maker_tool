# TrueStoryMaker

Convierte un post de Reddit en un video vertical (1080×1920) con voz IA, subtítulos palabra por
palabra y fondo de gameplay. Corre completo en tu PC: voz local con Kokoro, render con Remotion.

```
Link de Reddit / texto ─► guion (literal o Claude) ─► voz Kokoro + tiempos por palabra
                       ─► vista previa en el navegador ─► MP4
```

## Requisitos

- Node 20+ (probado con 24)
- [uv](https://docs.astral.sh/uv/) (instala Python 3.12 solo para el servicio de voz)
- ~1 GB libre: modelo Kokoro (~350 MB), Whisper base (~150 MB) y Chrome headless de Remotion (~120 MB),
  todo se descarga la primera vez.

## Instalación

```bash
npm install
npm run setup:tts
```

Toda la configuración de modelos, proveedores y credenciales se hace en la app, pestaña **Ajustes**. Se guarda
en `data/ai.json` y `data/secrets.json` (fuera de git); la interfaz nunca recibe las claves completas. El `.env`
queda solo para puertos y servicios locales (ver `.env.example`).

- **Modelos de IA**: agrega proveedores y elige un modelo por agente (Escritor, Curador, Divisor en partes,
  Guion y traducción, Publicación), cada uno con su nivel de esfuerzo.
  - *Anthropic (oficial)*: tu API key; modelo por defecto `claude-opus-5-5`.
  - *teamsoclo · Claude*: protocolo Anthropic, URL `https://gpt.teamsoclo.site` (sin `/v1`). En pasarelas no se
    envían funciones beta y, si no aceptan salida estructurada, se pide el JSON en el prompt.
  - *teamsoclo · GPT/Codex* u *OpenAI*: protocolo OpenAI-compatible, URL `https://gpt.teamsoclo.site/v1`,
    modelo p. ej. `gpt-5.6-sol`.
  - "Probar conexión" valida la clave y carga la lista de modelos del proveedor.
  - Ojo con las pasarelas de terceros: todo el texto que se les envía pasa por ellas, y teamsoclo no publica de
    dónde obtiene el acceso ni su política de datos.
- **Fuentes → Credenciales de Reddit**:
  - clave de [redditapis.com](https://docs.redditapis.com/docs) (de pago, ~$0.0015 por llamada): se usa para los
    links de Reddit y la fuente "Reddit" del pipeline;
  - o client id/secret de la API oficial, solo si Reddit te aprobó acceso. Según su
    [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
    todo acceso requiere aprobación (escrita para uso comercial). Sin nada de esto, usa **Pegar texto**.
- **Cuentas para publicar**: credenciales de tu app de YouTube, TikTok y Facebook (ver abajo).

Si tenías estas claves en un `.env` antiguo, la API las importa a Ajustes una vez al arrancar.

## Uso

```bash
npm run dev
```

Abre <http://localhost:5173>. Levanta tres procesos: voz (8766), API (8787) y web (5173).

1. Pega el link del post (o el texto), elige comentarios, idioma, voz, fondo y subtítulos.
2. Cuando termine la voz aparece la **vista previa**: cambia estilo de subtítulos, fondo o música sin
   regenerar la voz.
3. **Renderizar MP4** y descargar. Los archivos quedan en `jobs/<id>/final.mp4`.

### Fondos y música

- `assets/backgrounds/<categoría>/*.mp4`: tus clips de gameplay (Minecraft parkour, Subway Surfers…).
  Cada carpeta es una categoría. Usa clips que tengas derecho a usar. Si no hay clips, hay fondos
  animados incluidos.
- `assets/music/*.mp3`: música de fondo opcional.

## Pipeline automático

Pestañas **Panel → Historias → Videos → Publicaciones → Ajustes**:

1. **Descubrir**: el agente escribe historias **originales** (ficción en estilo Reddit, por géneros) con Claude.
   Si Reddit te aprueba acceso a su API, también puede traer posts top de subreddits por la API oficial.
   No hay scraping: Reddit lo prohíbe y bloquea esas peticiones.
2. **Curar**: Claude puntúa cada historia (1-10) y marca datos personales, contenido sensible o de odio.
   Con "aprobar automáticamente" las bien puntuadas sin alertas pasan solas.
3. **Producir**: cada historia aprobada genera su video (voz, subtítulos, render) sin intervención.
4. **Publicar**: por cada plataforma conectada se crean título, descripción y hashtags. Con "revisar
   antes de publicar" (recomendado) esperan tu aprobación; luego salen en los horarios configurados con
   un máximo diario por plataforma, reintentando fallos temporales.

Activa el **piloto automático** en Ajustes para que el ciclo corra cada N minutos. Todo queda en `data/`.

## Publicar en YouTube, TikTok y Facebook

Cada plataforma usa **tu propia app de desarrollador** y su API oficial. Pega sus credenciales en Ajustes →
Cuentas para publicar (tarjeta de cada plataforma),
registra el redirect URI `http://localhost:8787/api/auth/<plataforma>/callback` y pulsa **Conectar** en Ajustes.

| Plataforma | Dónde crear la app | Credenciales en Ajustes | Límite hasta la revisión de la plataforma |
| --- | --- | --- | --- |
| YouTube | Google Cloud Console → API "YouTube Data API v3" → credencial OAuth (aplicación web) | Client id + client secret | Videos subidos por apps no verificadas quedan privados |
| TikTok | developers.tiktok.com → app con "Login Kit" + "Content Posting API" (Direct Post) | Client key + client secret | Solo publicaciones privadas hasta pasar la auditoría |
| Facebook | developers.facebook.com → app tipo Business con permisos de Páginas | App id + app secret | Modo desarrollo: solo cuentas con rol en la app |

Los videos se marcan como contenido generado con IA (`containsSyntheticMedia` en YouTube, `is_aigc` en TikTok).

### Monetización

- Las plataformas desmonetizan contenido "reutilizado" o repetitivo. Las historias originales, voces y
  fondos variados y un ritmo de publicación moderado ayudan.
- Usar posts de Reddit con fines comerciales requiere aprobación escrita de Reddit, y los textos son de sus autores.
- Usa clips de fondo y música que tengas derecho a usar.

## Estructura

| Carpeta | Qué hace |
| --- | --- |
| `apps/web` | React + Vite: formulario, progreso en vivo (SSE), vista previa con Remotion Player |
| `apps/api` | Node + Express: jobs, Reddit, Claude, llamada a la voz, render con Remotion |
| `apps/api/src/automation.ts` | Orquestador: descubrir → curar → producir → publicar, horarios y reintentos |
| `apps/api/src/agents.ts` | Agentes Claude: escritor de historias, curador, metadatos de publicación |
| `apps/api/src/publish/` | Publicadores YouTube, TikTok y Facebook (OAuth + APIs oficiales) |
| `data/` | Historias, publicaciones, ajustes, actividad y tokens de tus cuentas (`accounts.json`) |
| `packages/video` | Composición Remotion compartida (fondo, tarjeta de Reddit, subtítulos) |
| `services/tts` | Python + FastAPI: Kokoro (voz) + faster-whisper (tiempos por palabra) |
| `jobs/` | Un directorio por video: `job.json`, `voice.wav`, `composition.json`, `final.mp4` |

## Despliegue (Docker / Coolify)

Dos contenedores (`app` y `tts`) definidos en `docker-compose.yml`, con validaciones al arrancar, healthchecks
y CI que construye las imágenes y renderiza un video de prueba. Guía: [docs/deploy-coolify.md](docs/deploy-coolify.md).

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Voz + API + web |
| `npm test` | Pruebas (Vitest + pytest) |
| `npm run typecheck` | TypeScript en todos los paquetes |
| `npm run smoke` | Video de prueba de punta a punta sin red (requiere `npm run tts` corriendo) |
| `npm run studio` | Remotion Studio para editar la composición |

Diseño: [docs/superpowers/specs/2026-10-31-truestorymaker-design.md](docs/superpowers/specs/2026-10-31-truestorymaker-design.md)
