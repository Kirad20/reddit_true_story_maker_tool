# Desplegar en Coolify

La app corre como dos contenedores definidos en [`docker-compose.yml`](../docker-compose.yml):

| Servicio | Qué hace | Puerto interno |
| --- | --- | --- |
| `app` | API + interfaz web + render de video (Remotion con Chrome headless) | 8787 |
| `tts` | Voz Kokoro + tiempos por palabra (faster-whisper). Modelos incluidos en la imagen | 8766 (solo red interna) |

Volúmenes persistentes: `app-data` (ajustes, claves, historias, publicaciones), `app-jobs` (voces y videos,
compartido con `tts`), `app-assets` (tus clips de fondo y música).

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
4. **Variables de entorno** (pestaña *Environment Variables*):
   - `APP_PASSWORD` (**obligatoria**, 12+ caracteres). Sin ella Coolify no despliega y la app no arranca.
   - `APP_USER` (opcional, por defecto `admin`).
   - `PUBLIC_URL` (opcional): solo si quieres forzar una URL distinta a la del dominio asignado.
5. **Deploy**. Coolify espera a que `tts` esté sano antes de iniciar `app` (healthchecks del compose).
6. Abre el dominio: el navegador pedirá usuario y contraseña (`APP_USER` / `APP_PASSWORD`).
7. **Configura en la app** (Ajustes): proveedores y modelos por agente, credenciales de Reddit y de tus apps de
   YouTube/TikTok/Facebook. Para cada plataforma registra el redirect URI
   `https://stories.tudominio.com/api/auth/<youtube|tiktok|facebook>/callback`.
8. **Fondos y música** (opcional): copia tus clips al volumen `app-assets` en `backgrounds/<categoría>/` y
   `music/` (por ejemplo con `docker cp` o el terminal del contenedor en Coolify).

## Validaciones

- **Al arrancar**, la API revisa la configuración y se niega a iniciar si en producción falta `APP_PASSWORD`
  o es corta, si `PUBLIC_URL` no es https, si un puerto o URL es inválido o si los volúmenes no se pueden escribir.
  Los motivos aparecen en los logs del contenedor `app`.
- **Healthchecks**: `GET /api/health` (vida, sin contraseña) en `app`; `GET /health` en `tts`.
  `GET /api/ready` (con contraseña) confirma además que la voz responde y que los volúmenes son escribibles.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) en cada push a `main` y en cada PR:
  typecheck, pruebas (Vitest y pytest), build de la web, validación del compose (incluido que rechace un
  `APP_PASSWORD` vacío), build de ambas imágenes y prueba de humo del stack completo: autenticación,
  readiness, interfaz y **un video renderizado de punta a punta dentro de los contenedores**.
  Conviene activar en Coolify el despliegue automático por webhook solo cuando el CI esté en verde
  (protección de rama en GitHub).

## Probar el stack en local

```bash
APP_PASSWORD=una-clave-larga-local docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Abre <http://localhost:8787> con usuario `admin` y esa contraseña.

## Seguridad

- Todo el sitio (interfaz, API y archivos de video) exige la contraseña, excepto `/api/health`.
- Las claves de modelos y plataformas viven en el volumen `app-data` (`secrets.json`), nunca en git ni en
  variables de entorno, y la interfaz solo muestra sus últimos 4 caracteres. Haz copias de seguridad del
  volumen: Coolify persiste los datos entre despliegues, pero eso no es un respaldo.
- El servicio `tts` no se publica y solo escribe dentro del volumen de trabajos.
