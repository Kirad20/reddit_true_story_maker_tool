// Public legal pages (Terms of Service and Privacy Policy), served without login at /terms and /privacy.
// YouTube (Google), TikTok and Meta ask for both URLs when you register the developer apps used to publish.
// Spanish first, English below (#en) for the platform reviewers.
import { FACEBOOK_SCOPES, TIKTOK_SCOPES, YOUTUBE_SCOPES } from "./publish/scopes";

/** Date shown as "last updated"; bump it whenever the text changes. */
export const LEGAL_UPDATED = "2026-10-31";

export type LegalPage = "terms" | "privacy";

export interface LegalOptions {
  /** Who runs this instance (LEGAL_OPERATOR). */
  operator?: string;
  /** Contact address for privacy and deletion requests (LEGAL_CONTACT_EMAIL). */
  contactEmail?: string;
  /** Public URL of the deployment, for absolute links. */
  publicUrl?: string;
}

export function legalOptionsFromEnv(env: NodeJS.ProcessEnv, publicUrl?: string | null): LegalOptions {
  return {
    operator: env.LEGAL_OPERATOR?.trim() || undefined,
    contactEmail: env.LEGAL_CONTACT_EMAIL?.trim() || undefined,
    publicUrl: publicUrl ?? undefined,
  };
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const codes = (scopes: string[]) => scopes.map((s) => `<code>${escape(s)}</code>`).join(", ");

interface Ctx {
  operator: string;
  contactEs: string;
  contactEn: string;
  terms: string;
  privacy: string;
}

function context(opts: LegalOptions): Ctx {
  const base = opts.publicUrl?.replace(/\/+$/, "") ?? "";
  const email = opts.contactEmail ? escape(opts.contactEmail) : null;
  const mail = email ? `<a href="mailto:${email}">${email}</a>` : null;
  return {
    operator: escape(opts.operator ?? "el operador de esta instancia de TrueStoryMaker"),
    contactEs: mail ?? "el administrador de esta instancia",
    contactEn: mail ?? "the administrator of this instance",
    terms: `${base}/terms`,
    privacy: `${base}/privacy`,
  };
}

function operatorEn(opts: LegalOptions): string {
  return escape(opts.operator ?? "the operator of this TrueStoryMaker instance");
}

function privacyEs(c: Ctx): string {
  return `
<h1>Política de privacidad</h1>
<p class="meta">Última actualización: ${LEGAL_UPDATED}</p>
<p>Esta política explica qué datos trata <b>TrueStoryMaker</b> (el "Servicio"), una herramienta que convierte historias
de texto en videos verticales con voz y subtítulos y, si el usuario lo autoriza, los publica en sus propias cuentas de
YouTube, TikTok y Facebook. El responsable del tratamiento es ${c.operator}. Contacto: ${c.contactEs}.</p>

<h2>1. Quién usa el Servicio</h2>
<p>El Servicio es privado: no hay registro público. Solo pueden entrar las personas a quienes un administrador les crea
una cuenta. No está dirigido a menores de 18 años.</p>

<h2>2. Datos que tratamos</h2>
${list([
  "<b>Cuenta de usuario</b>: nombre, correo, contraseña (guardada solo como hash), rol, y datos de sesión (cookie de sesión, dirección IP y agente de usuario del navegador).",
  "<b>Cuentas conectadas</b>: cuando conectas YouTube, TikTok o Facebook guardamos los tokens de acceso OAuth que la plataforma emite y datos básicos del perfil (identificador, nombre visible, foto, y en Facebook la lista de páginas que administras), solo para publicar en tu nombre.",
  "<b>Contenido</b>: historias, textos pegados, guiones, audio de voz generado, subtítulos, videos, títulos, descripciones y hashtags, junto con su estado y horario de publicación.",
  "<b>Registros técnicos</b>: auditoría de cambios (usuario, acción, resultado) y telemetría de las llamadas a modelos de IA (prompts, respuestas, tokens, costo estimado) para depurar y controlar costos.",
])}
<p>No recopilamos datos de las personas que ven los videos en las plataformas, ni datos de pago.</p>

<h2>3. Permisos que pedimos a cada plataforma</h2>
${list([
  `<b>YouTube (Google)</b>: ${codes(YOUTUBE_SCOPES)} — subir los videos que apruebas y leer el canal para mostrar en qué cuenta se publicará.`,
  `<b>TikTok</b>: ${codes(TIKTOK_SCOPES)} — mostrar tu perfil básico y publicar los videos que apruebas.`,
  `<b>Facebook (Meta)</b>: ${codes(FACEBOOK_SCOPES)} — listar tus páginas y publicar videos en la página que elijas.`,
])}
<p>No usamos estos permisos para leer tus mensajes, contactos, seguidores ni otro contenido, ni para publicar nada que no
hayas aprobado o programado en el Servicio.</p>

<h2>4. Para qué usamos los datos</h2>
${list([
  "Iniciar sesión y proteger el acceso.",
  "Generar los guiones, la voz y los videos que pides.",
  "Publicar o programar los videos en las cuentas que conectaste.",
  "Mantener la seguridad, auditar cambios, depurar errores y estimar costos.",
])}
<p>No vendemos ni alquilamos datos, no mostramos publicidad, no usamos cookies de seguimiento ni de terceros, y no
usamos los datos de las plataformas para entrenar modelos de IA.</p>

<h2>5. Con quién se comparten</h2>
<p>Solo con los servicios necesarios para funcionar, y solo lo que cada uno necesita:</p>
${list([
  "<b>Proveedores de modelos de IA</b> configurados en el Servicio (por ejemplo Anthropic u otros compatibles con OpenAI): reciben el texto de las historias para escribir, revisar o traducir guiones. No reciben tus tokens de las plataformas.",
  "<b>YouTube, TikTok y Meta</b>: reciben los videos y sus textos cuando se publican, bajo sus propias políticas de privacidad.",
  "<b>Fuentes de historias</b> (API de Reddit o redditapis.com), si están configuradas: reciben la dirección del post a consultar.",
  "<b>Almacenamiento</b> (servidor propio o un bucket compatible con S3) donde viven los archivos.",
])}
<p>También podemos revelar datos si la ley lo exige.</p>

<h2>6. Uso de datos de las API de Google</h2>
<p>El uso y la transferencia a cualquier otra aplicación de la información recibida de las API de Google cumple la
<a href="https://developers.google.com/terms/api-services-user-data-policy">Política de datos de usuario de los servicios de API de Google</a>,
incluidos los requisitos de Uso limitado. El Servicio usa la API de YouTube; al conectarlo aceptas también las
<a href="https://www.youtube.com/t/terms">Condiciones del servicio de YouTube</a> y la
<a href="https://policies.google.com/privacy">Política de privacidad de Google</a>.</p>

<h2>7. Conservación y eliminación</h2>
${list([
  "Los datos se conservan mientras tu cuenta exista o mientras sean necesarios para el Servicio.",
  "Puedes <b>desconectar</b> una plataforma en Ajustes → Cuentas para publicar: se borran sus tokens y datos de perfil guardados. También puedes revocar el acceso desde la plataforma: <a href=\"https://myaccount.google.com/permissions\">Google</a>, TikTok (Ajustes → Seguridad → Apps y servicios) o <a href=\"https://www.facebook.com/settings?tab=business_tools\">Facebook</a>.",
  "Puedes borrar videos e historias desde la app; se eliminan sus archivos.",
  `Para borrar tu cuenta y todos tus datos, o pedir una copia, escribe a ${c.contactEs}. Respondemos en un máximo de 30 días.`,
  "Los videos ya publicados en una plataforma se borran desde esa plataforma.",
])}

<h2>8. Seguridad</h2>
<p>Las contraseñas se guardan con hash, las sesiones usan cookies seguras, las claves y tokens se guardan en el servidor
y nunca se envían completos al navegador, y el acceso está limitado a usuarios autorizados. Ningún sistema es 100 %
seguro; si detectamos un incidente que te afecte te avisaremos.</p>

<h2>9. Tus derechos</h2>
<p>Según la ley que te aplique (por ejemplo el RGPD o leyes locales de protección de datos) puedes pedir acceso,
rectificación, eliminación, limitación, portabilidad u oponerte al tratamiento escribiendo a ${c.contactEs}, y reclamar
ante tu autoridad de protección de datos.</p>

<h2>10. Cambios</h2>
<p>Si cambiamos esta política actualizaremos la fecha de arriba; los cambios importantes se avisarán dentro del Servicio.
Ver también los <a href="${c.terms}">Términos del servicio</a>.</p>`;
}

function privacyEn(c: Ctx, op: string): string {
  return `
<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${LEGAL_UPDATED}</p>
<p>This policy explains what data <b>TrueStoryMaker</b> (the "Service") processes. The Service turns text stories into
vertical videos with AI voice and captions and, when the user authorizes it, publishes them to the user's own YouTube,
TikTok and Facebook accounts. The data controller is ${op}. Contact: ${c.contactEn}.</p>

<h2>1. Who uses the Service</h2>
<p>The Service is private: there is no public sign-up; only people given an account by an administrator can sign in.
It is not directed to anyone under 18.</p>

<h2>2. Data we process</h2>
${list([
  "<b>User account</b>: name, email, password (stored only as a hash), role, and session data (session cookie, IP address and browser user agent).",
  "<b>Connected accounts</b>: when you connect YouTube, TikTok or Facebook we store the OAuth access tokens the platform issues and basic profile data (ID, display name, avatar and, on Facebook, the list of Pages you manage), only to publish on your behalf.",
  "<b>Content</b>: stories, pasted text, scripts, generated voice audio, captions, videos, titles, descriptions and hashtags, with their publishing status and schedule.",
  "<b>Technical logs</b>: an audit trail of changes (user, action, result) and telemetry of AI model calls (prompts, responses, tokens, estimated cost) for debugging and cost control.",
])}
<p>We do not collect data about people who watch the videos on the platforms, and we do not process payments.</p>

<h2>3. Permissions requested from each platform</h2>
${list([
  `<b>YouTube (Google)</b>: ${codes(YOUTUBE_SCOPES)} — upload the videos you approve and read your channel to show which account will be used.`,
  `<b>TikTok</b>: ${codes(TIKTOK_SCOPES)} — show your basic profile and publish the videos you approve.`,
  `<b>Facebook (Meta)</b>: ${codes(FACEBOOK_SCOPES)} — list your Pages and publish videos to the Page you choose.`,
])}
<p>We never use these permissions to read your messages, contacts, followers or other content, or to publish anything
you have not approved or scheduled in the Service.</p>

<h2>4. How we use data</h2>
${list([
  "To sign you in and protect access.",
  "To generate the scripts, voice and videos you request.",
  "To publish or schedule videos on the accounts you connected.",
  "To keep the Service secure, audit changes, fix errors and estimate costs.",
])}
<p>We do not sell or rent data, show ads, use tracking or third-party cookies, or use platform data to train AI models.</p>

<h2>5. Sharing</h2>
<p>Only with the services needed to operate, and only what each one needs:</p>
${list([
  "<b>AI model providers</b> configured in the Service (e.g. Anthropic or OpenAI-compatible providers): they receive story text to write, review or translate scripts. They never receive your platform tokens.",
  "<b>YouTube, TikTok and Meta</b>: they receive the videos and their texts when published, under their own privacy policies.",
  "<b>Story sources</b> (Reddit API or redditapis.com), if configured: they receive the address of the post to fetch.",
  "<b>Storage</b> (our own server or an S3-compatible bucket) where files are kept.",
])}
<p>We may also disclose data when required by law.</p>

<h2>6. Google API Services</h2>
<p>TrueStoryMaker's use and transfer to any other app of information received from Google APIs will adhere to the
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
including the Limited Use requirements. The Service uses the YouTube API Services; by connecting YouTube you also agree
to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and the
<a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>

<h2>7. Retention and deletion</h2>
${list([
  "Data is kept while your account exists or while it is needed to provide the Service.",
  "You can <b>disconnect</b> a platform in Settings → Publishing accounts: its stored tokens and profile data are deleted. You can also revoke access from the platform: <a href=\"https://myaccount.google.com/permissions\">Google</a>, TikTok (Settings → Security → Apps and services) or <a href=\"https://www.facebook.com/settings?tab=business_tools\">Facebook</a>.",
  "You can delete videos and stories in the app; their files are removed.",
  `To delete your account and all your data, or to request a copy, contact ${c.contactEn}. We answer within 30 days.`,
  "Videos already published on a platform are deleted on that platform.",
])}

<h2>8. Security</h2>
<p>Passwords are hashed, sessions use secure cookies, keys and tokens stay on the server and are never sent in full to
the browser, and access is limited to authorized users. No system is 100% secure; we will notify you of any incident
that affects you.</p>

<h2>9. Your rights</h2>
<p>Depending on the law that applies to you (e.g. GDPR, CCPA or local data-protection laws) you may request access,
correction, deletion, restriction or portability of your data, or object to processing, by contacting ${c.contactEn},
and you may complain to your data-protection authority.</p>

<h2>10. Changes</h2>
<p>If we change this policy we will update the date above; material changes will be announced in the Service. See also
the <a href="${c.terms}">Terms of Service</a>.</p>`;
}

function termsEs(c: Ctx): string {
  return `
<h1>Términos del servicio</h1>
<p class="meta">Última actualización: ${LEGAL_UPDATED}</p>
<p>Estos términos regulan el uso de <b>TrueStoryMaker</b> (el "Servicio"), operado por ${c.operator}. Al usar el
Servicio aceptas estos términos y la <a href="${c.privacy}">Política de privacidad</a>. Si no estás de acuerdo, no lo
uses.</p>

<h2>1. El Servicio</h2>
<p>El Servicio genera videos verticales a partir de historias de texto (escritas por IA, pegadas por ti o tomadas de
fuentes autorizadas) con voz sintética, subtítulos y fondos, y te permite publicarlos en tus cuentas de YouTube,
TikTok y Facebook mediante sus API oficiales.</p>

<h2>2. Cuentas</h2>
${list([
  "El acceso es solo por invitación de un administrador. Debes tener al menos 18 años.",
  "Eres responsable de tu contraseña y de lo que se haga con tu cuenta. Avísanos si sospechas un acceso indebido.",
  "Al conectar una plataforma declaras que eres titular de esa cuenta o estás autorizado a publicar en ella.",
])}

<h2>3. Tu contenido y tus responsabilidades</h2>
${list([
  "Conservas los derechos sobre el contenido que aportas y sobre los videos generados, en la medida que la ley lo permita.",
  "Debes tener derecho a usar todo lo que subas o pegues: textos, clips de fondo, música e imágenes.",
  "Revisas y apruebas lo que se publica. Eres responsable de que cumpla la ley y las normas de cada plataforma (<a href=\"https://www.youtube.com/t/terms\">YouTube</a>, <a href=\"https://www.tiktok.com/legal/terms-of-service\">TikTok</a>, <a href=\"https://www.facebook.com/terms\">Meta</a>), incluidas las de contenido generado con IA.",
  "Los videos se marcan como contenido generado o alterado con IA cuando la plataforma lo permite; no debes ocultar ni quitar esa indicación.",
])}

<h2>4. Uso prohibido</h2>
<p>No puedes usar el Servicio para:</p>
${list([
  "publicar contenido ilegal, de odio, acoso, violencia gráfica, sexual con menores o que infrinja derechos de terceros;",
  "difundir datos personales de otras personas o hacer pasar historias inventadas como hechos reales sobre personas identificables;",
  "hacer spam, manipular métricas o eludir los límites y políticas de las plataformas;",
  "extraer datos de sitios que lo prohíben, o acceder sin permiso a sistemas o cuentas ajenas;",
  "intentar vulnerar la seguridad del Servicio.",
])}

<h2>5. Contenido generado con IA</h2>
<p>Los guiones, voces y traducciones los generan modelos de IA y pueden contener errores, inexactitudes o contenido
inesperado. Las historias escritas por el Servicio son ficción. Revisa todo antes de publicarlo.</p>

<h2>6. Servicios de terceros</h2>
<p>El Servicio depende de terceros (proveedores de IA, YouTube, TikTok, Meta, fuentes de historias, almacenamiento).
Su uso se rige por sus propios términos; no controlamos su disponibilidad ni sus cambios, y una plataforma puede
rechazar, limitar o borrar publicaciones. Al usar la integración con YouTube aceptas las
<a href="https://www.youtube.com/t/terms">Condiciones del servicio de YouTube</a>.</p>

<h2>7. Suspensión y baja</h2>
<p>Podemos suspender o cerrar cuentas que incumplan estos términos o pongan en riesgo el Servicio. Puedes dejar de usarlo
en cualquier momento, desconectar tus plataformas y pedir que borremos tus datos (ver la Política de privacidad).</p>

<h2>8. Sin garantías</h2>
<p>El Servicio se ofrece "tal cual" y "según disponibilidad", sin garantías de ningún tipo, expresas o implícitas, en la
medida que la ley lo permita. No garantizamos resultados de audiencia, monetización ni que las publicaciones se acepten.</p>

<h2>9. Limitación de responsabilidad</h2>
<p>En la medida que la ley lo permita, ${c.operator} no responde por daños indirectos, pérdida de datos, ingresos,
cuentas o audiencia, ni por el contenido que publiques o las decisiones de las plataformas. Nada de esto limita
derechos que la ley no permita excluir.</p>

<h2>10. Cambios y contacto</h2>
<p>Podemos actualizar estos términos; la fecha de arriba indica la versión vigente y seguir usando el Servicio implica
aceptarla. Estos términos se rigen por la ley del lugar de residencia del operador. Contacto: ${c.contactEs}.</p>`;
}

function termsEn(c: Ctx, op: string): string {
  return `
<h1>Terms of Service</h1>
<p class="meta">Last updated: ${LEGAL_UPDATED}</p>
<p>These terms govern the use of <b>TrueStoryMaker</b> (the "Service"), operated by ${op}. By using the Service you
agree to these terms and to the <a href="${c.privacy}">Privacy Policy</a>. If you do not agree, do not use it.</p>

<h2>1. The Service</h2>
<p>The Service creates vertical videos from text stories (written by AI, pasted by you or taken from authorized
sources) with synthetic voice, captions and backgrounds, and lets you publish them to your YouTube, TikTok and Facebook
accounts through their official APIs.</p>

<h2>2. Accounts</h2>
${list([
  "Access is by administrator invitation only. You must be at least 18 years old.",
  "You are responsible for your password and for activity under your account. Tell us if you suspect unauthorized access.",
  "By connecting a platform you confirm you own that account or are authorized to publish on it.",
])}

<h2>3. Your content and responsibilities</h2>
${list([
  "You keep the rights to the content you provide and to the generated videos, to the extent the law allows.",
  "You must have the right to use everything you upload or paste: text, background clips, music and images.",
  "You review and approve what gets published, and you are responsible for it complying with the law and each platform's rules (<a href=\"https://www.youtube.com/t/terms\">YouTube</a>, <a href=\"https://www.tiktok.com/legal/terms-of-service\">TikTok</a>, <a href=\"https://www.facebook.com/terms\">Meta</a>), including rules on AI-generated content.",
  "Videos are labeled as AI-generated or altered content where the platform supports it; you must not hide or remove that label.",
])}

<h2>4. Prohibited use</h2>
<p>You may not use the Service to:</p>
${list([
  "publish illegal, hateful, harassing, graphically violent or child-sexual content, or content that infringes others' rights;",
  "expose other people's personal data or present invented stories as real facts about identifiable people;",
  "spam, manipulate metrics or circumvent platform limits and policies;",
  "scrape sites that forbid it, or access other people's systems or accounts without permission;",
  "attempt to breach the security of the Service.",
])}

<h2>5. AI-generated content</h2>
<p>Scripts, voices and translations are produced by AI models and may contain errors, inaccuracies or unexpected
content. Stories written by the Service are fiction. Review everything before publishing.</p>

<h2>6. Third-party services</h2>
<p>The Service relies on third parties (AI providers, YouTube, TikTok, Meta, story sources, storage). Their use is
governed by their own terms; we do not control their availability or changes, and a platform may reject, limit or
remove posts. By using the YouTube integration you agree to the
<a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>

<h2>7. Suspension and termination</h2>
<p>We may suspend or close accounts that breach these terms or put the Service at risk. You may stop using it at any
time, disconnect your platforms and ask us to delete your data (see the Privacy Policy).</p>

<h2>8. No warranty</h2>
<p>The Service is provided "as is" and "as available", without warranties of any kind, express or implied, to the extent
permitted by law. We do not guarantee audience, monetization or that posts will be accepted.</p>

<h2>9. Limitation of liability</h2>
<p>To the extent permitted by law, ${op} is not liable for indirect damages, loss of data, revenue, accounts or
audience, or for the content you publish or the decisions of the platforms. Nothing here limits rights that cannot be
excluded by law.</p>

<h2>10. Changes and contact</h2>
<p>We may update these terms; the date above shows the current version and continuing to use the Service means you
accept it. These terms are governed by the law of the operator's place of residence. Contact: ${c.contactEn}.</p>`;
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fafafa; --muted: #666; --accent: #ff6a3d; --card: #fff; --line: #e5e5e5; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececec; --bg: #111214; --muted: #9a9a9a; --card: #18191c; --line: #2a2b2f; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
header { position: sticky; top: 0; background: var(--card); border-bottom: 1px solid var(--line); }
header .wrap { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding-top: 12px; padding-bottom: 12px; flex-wrap: wrap; }
.wrap { max-width: 820px; margin: 0 auto; padding: 0 20px; }
.brand { font-weight: 600; color: var(--fg); text-decoration: none; }
.brand span { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: #fff; font-size: 12px; margin-right: 6px; }
nav a { color: var(--muted); text-decoration: none; margin-left: 14px; font-size: 14px; }
nav a.on, nav a:hover { color: var(--fg); }
main { padding: 32px 0 48px; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 8px 28px 24px; margin-bottom: 28px; }
h1 { font-size: 28px; margin: 20px 0 4px; }
h2 { font-size: 18px; margin: 28px 0 6px; }
.meta { color: var(--muted); margin-top: 0; font-size: 14px; }
a { color: var(--accent); }
code { font-size: 13px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; word-break: break-all; }
ul { padding-left: 22px; }
li { margin: 4px 0; }
footer { color: var(--muted); font-size: 13px; padding-bottom: 32px; }
`;

/** Full HTML document for a legal page. */
export function renderLegalPage(page: LegalPage, opts: LegalOptions = {}): string {
  const c = context(opts);
  const op = operatorEn(opts);
  const title = page === "terms" ? "Términos del servicio · Terms of Service" : "Política de privacidad · Privacy Policy";
  const es = page === "terms" ? termsEs(c) : privacyEs(c);
  const en = page === "terms" ? termsEn(c, op) : privacyEn(c, op);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — TrueStoryMaker</title>
<meta name="robots" content="index, follow" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23ff6a3d'/><path d='M12 9l12 7-12 7z' fill='white'/></svg>" />
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/"><span>▶</span>TrueStoryMaker</a>
  <nav>
    <a href="/terms"${page === "terms" ? ' class="on"' : ""}>Términos · Terms</a>
    <a href="/privacy"${page === "privacy" ? ' class="on"' : ""}>Privacidad · Privacy</a>
    <a href="#es">Español</a>
    <a href="#en">English</a>
  </nav>
</div></header>
<main class="wrap">
  <article id="es" lang="es">${es}</article>
  <article id="en" lang="en">${en}</article>
</main>
<footer class="wrap">© TrueStoryMaker · <a href="/terms">Términos / Terms</a> · <a href="/privacy">Privacidad / Privacy</a></footer>
</body>
</html>`;
}

/** Paths each page answers on (English and Spanish aliases). */
export const LEGAL_ROUTES: Record<string, LegalPage> = {
  "/terms": "terms",
  "/terminos": "terms",
  "/privacy": "privacy",
  "/privacidad": "privacy",
};
