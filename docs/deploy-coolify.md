# Desplegar en Coolify

La app corre como dos contenedores definidos en [`docker-compose.yml`](../docker-compose.yml):

| Servicio | Qué hace | Puerto interno |
| --- | --- | --- |
| `app` | API + interfaz web + render de video (Remotion con Chrome headless) | 8787 |
| `tts` | Voz Kokoro + tiempos por palabra (faster-whisper). Modelos incluidos en la imagen | 8766 (solo red interna) |

Volúmenes persistentes: `app-data` (ajustes, claves, usuarios y sesiones, historias, publicaciones), `app-jobs` (voces y videos,
compartido con `tts`), `app-assets` (tus clips de fondo y música, solo si no usas un bucket S3; ver
[Fondos y música en SeaweedFS](#fondos-y-música-en-seaweedfs-u-otro-s3)).

## Requisitos del servidor

- 2 vCPU y 4 GB de RAM como mínimo (el render de video y la voz usan CPU); 8 GB recomendado.
- ~6 GB de disco para las imágenes, más el espacio de tus videos.
- Primer build: 10-15 minutos (descarga Chrome headless, el modelo de voz ~350 MB y Whisper).

## Pasos

1. **Nuevo recurso**: en tu proyecto de Coolify → *+ New* → *Public/Private Repository* con
   `https://github.com/Kirad20/reddit_true_story_maker_tool` (rama `main`).
2. **Build pack**: *Docker Compose*. Base directory `/`, Docker Compose location `/docker-compose.yml`.
3. **Dominio**: en el servicio `app`, asigna tu dominio con el puerto interno, por ejemplo
   `https://stories.tudominio.com:8787`. Coolify rellena `SERVICE_URL_APP_8787` y la app lo usa como `PUBLIC_URL`.
   No asignes dominio a `tts`: solo debe ser accesible desde `app`.
4. **Variables de entorno** (pestaña *Environment Variables*), todas opcionales:
   - `PUBLIC_URL`: solo si quieres forzar una URL distinta a la del dominio asignado.
   - `TRUSTED_ORIGINS`: otros orígenes desde los que se permite iniciar sesión, separados por comas. El dominio por el
     que llega cada petición (cabeceras `X-Forwarded-Host`/`X-Forwarded-Proto` del proxy de Coolify) ya se acepta solo.
   - `BETTER_AUTH_SECRET` (32+ caracteres): firma las sesiones. Si la dejas vacía se genera una y se guarda en
     `app-data/auth-secret`.
   - `SETUP_PASSWORD` (12+ caracteres) y `SETUP_EMAIL`: credenciales fijas para el usuario temporal (ver abajo).
     Sin ellas el correo es `setup@truestorymaker.local` y la contraseña es aleatoria.
5. **Deploy**. Coolify espera a que `tts` esté sano antes de iniciar `app` (healthchecks del compose).
6. **Primer acceso** (usuario temporal): mientras no exista ningún usuario, la app crea un administrador
   temporal y escribe sus credenciales en los logs del contenedor `app`:
   ```
   [auth] ================= TEMPORARY SETUP USER =================
   [auth]   email:    setup@truestorymaker.local
   [auth]   password: …
   ```
   Abre el dominio, entra con esos datos, ve a **Usuarios** y crea tu cuenta con rol **Administrador**. En ese
   momento el usuario temporal y su sesión se borran solos y entras con tu cuenta. (Si reinicias antes de hacerlo,
   la contraseña aleatoria cambia: búscala de nuevo en los logs.)
7. **Configura en la app** (Ajustes): proveedores y modelos por agente, credenciales de Reddit y de tus apps de
   YouTube/TikTok/Facebook. Para cada plataforma registra el redirect URI (también aparece en su tarjeta)
   `https://stories.tudominio.com/api/identity/callback/<google|tiktok|facebook>` (YouTube usa `google`) y
   pulsa **Conectar**. La conexión pasa por Better Auth: los tokens quedan cifrados en `app-data/auth.db`
   y se renuevan solos.
8. **Fondos y música** (opcional): recomendado en un bucket de SeaweedFS (ver la sección siguiente). Sin bucket,
   copia tus clips al volumen `app-assets` en `backgrounds/<categoría>/` y `music/` (por ejemplo con `docker cp` o
   el terminal del contenedor en Coolify).

## Fondos y música en SeaweedFS (u otro S3)

Con `S3_BUCKET` definido, la app lee los clips de fondo y la música de un bucket compatible con S3 en lugar del
volumen `app-assets`. Sirve SeaweedFS, MinIO, Garage, Cloudflare R2 o AWS S3. Los videos generados (`app-jobs`)
siguen en su volumen.

- **El bucket puede ser privado.** La API transmite los archivos al reproductor y al renderizador por
  `/media/assets/...` (con peticiones por rangos y tras el login), así que el S3 solo tiene que ser accesible desde
  el contenedor `app`, no desde internet.
- **Misma estructura que la carpeta**: `<S3_PREFIX>backgrounds/<categoría>/<clip>.mp4` y `<S3_PREFIX>music/<canción>.mp3`.
  Cada "carpeta" de `backgrounds/` es una categoría. La lista se refresca cada 30 s: lo que subas aparece solo.
- **Duración de los clips**: se lee solo la cabecera del video (unos KB por peticiones por rangos), no el archivo entero.

### Variables (servicio `app`)

| Variable | Ejemplo | Notas |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://seaweedfs:8333` | Gateway S3 de SeaweedFS (`weed s3`, puerto 8333 por defecto). Vacío = AWS |
| `S3_BUCKET` | `truestorymaker` | Activa el almacenamiento S3 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | | Las de tu `s3.json` de SeaweedFS. Déjalas vacías si tu SeaweedFS corre sin identidades |
| `S3_PREFIX` | `assets` | Opcional: carpeta dentro del bucket |
| `S3_REGION` | `us-east-1` | SeaweedFS la ignora |
| `S3_FORCE_PATH_STYLE` | `true` | Por defecto `true` (necesario en SeaweedFS/MinIO); `false` para AWS con dominios virtuales |

### Pasos con SeaweedFS

1. **Red**: el contenedor `app` debe llegar al gateway S3. Si SeaweedFS es otro recurso de Coolify en el mismo
   servidor, activa *Connect to Predefined Network* en ambos y usa su nombre de servicio
   (`http://<servicio-seaweedfs>:8333`); si no, usa su URL pública (`https://s3.tudominio.com`).
2. **Crea el bucket** (una vez), con `weed shell` o con cualquier cliente S3:
   ```bash
   echo "s3.bucket.create -name truestorymaker" | weed shell
   ```
   ```bash
   aws --endpoint-url http://seaweedfs:8333 s3 mb s3://truestorymaker
   ```
3. **Credenciales**: si SeaweedFS usa `-s3.config=s3.json`, crea una identidad con acciones `Read`, `List` (y `Write`
   si vas a subir con ella) sobre el bucket y pon su clave en `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
4. **Variables** en Coolify (tabla de arriba) y **Redeploy**. Al arrancar, los logs de `app` muestran
   `[assets] backgrounds and music from S3` o el motivo si no llega al bucket. `GET /api/ready` incluye
   `"assets":{"kind":"s3","ok":true}`.
5. **Sube los archivos**:
   - desde tu PC, con tu carpeta `assets/` local y las mismas variables `S3_*` en `.env` (apuntando a la URL
     pública del S3): `npm run assets:push` (añade `-- --dry-run` para ver qué subiría; omite lo que ya está con el
     mismo tamaño);
   - o con cualquier cliente S3: `aws --endpoint-url … s3 sync assets/ s3://truestorymaker/`
     (con `S3_PREFIX`, súbelo a `s3://truestorymaker/<prefijo>/`), o el filer web de SeaweedFS (puerto 8888).
6. Si migras desde el volumen `app-assets`, puedes hacer el `assets:push` desde el terminal del contenedor `app`
   (los archivos están en `/app/assets`) y luego borrar el volumen.

Si el bucket no responde, la app sigue funcionando con los fondos animados: la vista de fondos muestra el error y
`/api/ready` devuelve 503.

## Validaciones

- **Al arrancar**, la API revisa la configuración y se niega a iniciar si en producción `BETTER_AUTH_SECRET` o
  `SETUP_PASSWORD` son demasiado cortas, si `PUBLIC_URL` no es https, si un puerto o URL es inválido o si los volúmenes no se pueden escribir.
  Los motivos aparecen en los logs del contenedor `app`.
- **S3**: con `S3_BUCKET`, la API se niega a iniciar si `S3_ENDPOINT` no es una URL http(s), si solo hay una de las
  dos claves o si `S3_FORCE_PATH_STYLE` no es `true`/`false`. Si el bucket no responde al arrancar, solo avisa.
- **Healthchecks**: `GET /api/health` (vida, sin contraseña) en `app`; `GET /health` en `tts`.
  `GET /api/ready` (con sesión iniciada) confirma además que la voz responde, que los volúmenes son escribibles y,
  con S3, que el bucket responde.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) en cada push a `main` y en cada PR:
  typecheck, pruebas (Vitest y pytest), build de la web, validación del compose, build de ambas imágenes y
  prueba de humo del stack completo: login con el usuario temporal,
  readiness, interfaz y **un video renderizado de punta a punta dentro de los contenedores**.
  Conviene activar en Coolify el despliegue automático por webhook solo cuando el CI esté en verde
  (protección de rama en GitHub).

## Probar el stack en local

```bash
SETUP_PASSWORD=una-clave-larga-local docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Abre <http://localhost:8787> y entra con `setup@truestorymaker.local` y esa contraseña; luego crea tu usuario en **Usuarios**.

## Problemas comunes

- **`{"message":"Invalid origin","code":"INVALID_ORIGIN"}` al iniciar sesión**: el navegador está en una URL que
  la app no reconoce. Al arrancar, los logs de `app` muestran `[auth] trusted origins: …`. Desde esta versión el
  dominio por el que entras se acepta automáticamente; si usas otra URL (por ejemplo otro dominio que apunta al
  mismo servicio sin pasar por el proxy), añádela en `TRUSTED_ORIGINS` y redespliega.

## Seguridad

- Login con [Better Auth](https://better-auth.com) (correo y contraseña, sesiones en cookie `httpOnly`). La API y
  los archivos de video exigen sesión, excepto `/api/health` y los endpoints de login (`/api/identity/*`).
- No hay registro público: solo un administrador crea cuentas en **Usuarios**, donde también puede cambiar
  roles (Administrador / Usuario), restablecer contraseñas, bloquear (cierra sus sesiones) y borrar usuarios.
  Los usuarios y sesiones viven en `app-data/auth.db` (SQLite).
- `APP_PASSWORD` / `APP_USER` (autenticación básica anterior) ya no se usan.
- Las claves de modelos y plataformas viven en el volumen `app-data` (`secrets.json`), nunca en git ni en
  variables de entorno, y la interfaz solo muestra sus últimos 4 caracteres. Haz copias de seguridad del
  volumen: Coolify persiste los datos entre despliegues, pero eso no es un respaldo.
- El servicio `tts` no se publica y solo escribe dentro del volumen de trabajos.
