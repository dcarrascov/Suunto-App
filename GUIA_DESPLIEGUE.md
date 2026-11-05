# Publicar la app en tu dominio con login

**Español** · [English](GUIDE_DEPLOY.md)

Por defecto la app solo se abre en tu ordenador, sin login, y **no necesitas nada de esta guía**. Sigue estos pasos solo si quieres abrirla desde cualquier sitio con tu propio dominio.

Entrarás con **usuario, contraseña y un código de 6 dígitos** que cambia cada 30 segundos. Los códigos son TOTP estándar: sirve cualquier app de autenticación (Oracle Mobile Authenticator, Google Authenticator, Aegis…).

```
Internet → Traefik (HTTPS) → Authelia (contraseña + código) → Suunto Stats
```

## ¿Qué servidor uso?

Sirve **cualquier servidor** en el que puedas ejecutar Docker. Te aconsejamos [**Dokploy**](https://dokploy.com), una alternativa a Vercel pero autoalojada: la instalas en tu propio servidor y te da despliegues desde GitHub y certificados HTTPS automáticos. Esta guía y `docker-compose.yml` están preparados para Dokploy. Si usas otra cosa, mira [Sin Dokploy](#sin-dokploy).

## Lo que necesitas

- Un servidor con Dokploy (o [sin él](#sin-dokploy)).
- Un dominio con dos subdominios apuntando al servidor (registro DNS `A`), por ejemplo:
  - `suunto.tudominio.com`: la app.
  - `auth.tudominio.com`: la pantalla de login.
- Docker en cualquier equipo, para generar el hash de tu contraseña (el del servidor vale).

## 1. Crea la aplicación en Dokploy

1. En tu proyecto: **Create Service → Compose**.
2. Como origen, tu copia del repositorio en GitHub, rama `main`, ruta `./docker-compose.yml`.

> Los dominios se configuran en `docker-compose.yml`: **no los añadas también** en la pestaña **Domains**.

## 2. Pon las variables

En la pestaña **Environment**, con tus valores:

```bash
SUUNTO_DOMAIN=suunto.tudominio.com
AUTH_DOMAIN=auth.tudominio.com
COOKIE_DOMAIN=tudominio.com

AUTH_PROXY_SECRET=...
AUTHELIA_SESSION_SECRET=...
AUTHELIA_STORAGE_ENCRYPTION_KEY=...
AUTHELIA_JWT_SECRET=...

SUUNTO_TIMEZONE=Europe/Madrid
SUUNTO_SESSION_KEY=...
GEMINI_API_KEY=...
# TP_AUTH_COOKIE=...
```

- **Los cuatro secretos** son cadenas aleatorias, una distinta para cada uno. Genera cada una con:

  ```bash
  openssl rand -hex 32
  ```

- **`SUUNTO_SESSION_KEY`** es el campo `sessionkey` del fichero que crea `suuntool login` en tu ordenador (`~/.config/suuntool/session.json`). Equivale a una contraseña. Si caduca, repite el login y cámbiala aquí.
- **La IA y TrainingPeaks** se configuran igual que en `.env.example`. `TP_AUTH_COOKIE` es opcional.

## 3. Crea los ficheros de Authelia

En **Advanced → Mounts**, añade dos **File Mounts**:

| Ruta | Contenido |
|---|---|
| `authelia/configuration.yml` | Copia tal cual [`deploy/authelia/configuration.yml`](deploy/authelia/configuration.yml) |
| `authelia/users_database.yml` | Parte de [`deploy/authelia/users_database.example.yml`](deploy/authelia/users_database.example.yml), con tus datos |

Para generar el hash de tu contraseña (la pide por pantalla):

```bash
docker run --rm -it authelia/authelia:4.39 authelia crypto hash generate argon2
```

> Comprueba que los ficheros quedan en `../files/authelia/`, la carpeta que monta `docker-compose.yml`. Si Dokploy los dejara en otra ruta, ajusta esa línea.

## 4. Comprueba Traefik y despliega

`docker-compose.yml` usa las entradas `web` y `websecure` y el certificado `letsencrypt`, los nombres habituales en Dokploy. Compruébalos en **Traefik File System → traefik.yml**. Si tu servidor usa otros, cámbialos en las etiquetas.

Después, pulsa **Deploy**.

## 5. Da de alta tu código

1. Abre `https://suunto.tudominio.com`: te llevará al login.
2. Entra con tu usuario y contraseña, y elige registrar un dispositivo **TOTP**.
3. Authelia te pedirá un código de verificación de un solo uso. Sin correo configurado, lo escribe en un fichero. Abre la terminal del contenedor `authelia` en Dokploy (o `docker exec` en el servidor) y léelo:

   ```bash
   cat /data/notification.txt
   ```

4. Escanea el QR con tu app de autenticación y escribe el código que te dé.

Comprueba que funciona: en **Ajustes → Acceso** debe poner «Protegido con Authelia · has entrado como …».

## 6. Descarga tus datos

La primera vez la app está vacía. Pulsa el **botón de recargar** junto a SUUNTO/STATS. Tus datos quedan guardados en un volumen y sobreviven a cada despliegue.

Para que se actualice sola, crea en Dokploy una **Schedule Job** de tipo Compose, sobre el servicio `app`, con el comando `./actualizar.sh`.

## Sin Dokploy

**Con Docker y Traefik**, sirve el mismo `docker-compose.yml` con estos ajustes:

1. Cambia la red `dokploy-network` por la de tu Traefik.
2. Crea un `.env` junto a `docker-compose.yml` con las variables del paso 2.
3. Crea la carpeta `../files/authelia/` con los ficheros del paso 3.
4. Comprueba los nombres del paso 4 y arranca con `docker compose up -d --build`.

**Con otro proxy (Nginx, Caddy…)** tendrás que escribir su configuración, porque no hay ninguna preparada. La app exige lo mismo con cualquiera:

- `AUTH_MODE=authelia` y `AUTH_PROXY_SECRET` en sus variables.
- Un proxy que compruebe el login y añada a cada petición el usuario (`Remote-User`) y el secreto (`X-Auth-Proxy-Secret`), sustituyendo lo que envíe el navegador.
- Que no se pueda llegar a la app sin pasar por ese proxy.

## Seguridad

- **Dos cerrojos.** Traefik pasa por Authelia y añade un secreto (`AUTH_PROXY_SECRET`) que la app exige. Sin él, la app rechaza la petición aunque alguien se invente la cabecera del usuario.
- **Sin puertos abiertos.** No añadas `ports:` a `app`: solo debe poder llegarse a ella por Traefik.
- **Si falta algo, se niega.** Sin `AUTH_MODE=authelia`, o sin el secreto, la app rechaza todo acceso desde fuera.
- **Tus datos y claves pasan al servidor:** la sesión de Suunto, la cookie de TrainingPeaks y la clave de la IA. Protege también el panel de Dokploy con su autenticación en dos pasos y mantén el servidor actualizado.
- **Nada de esto va al repositorio:** ni el `.env` de Dokploy ni `users_database.yml` deben subirse a GitHub.

## Lo que debes saber

- **Lo guardado en el navegador no se comparte entre dispositivos:** zapatillas, ajustes, entrenos propios y propuestas de la IA. Pásalos con **Ajustes → Copia de seguridad**.
- **Si caduca la sesión** con la app abierta, recarga la página para volver a identificarte.

## Problemas

| Qué pasa | Qué mirar |
|---|---|
| «Acceso no permitido» al abrir el dominio | Revisa que `AUTH_PROXY_SECRET` tenga al menos 32 caracteres y que las etiquetas de Traefik estén intactas. |
| Error de certificado o 404 | El DNS de los dos subdominios, y los nombres de `websecure` y `letsencrypt` del paso 4. |
| Authelia no arranca | Sus registros en Dokploy. Suele ser un fichero del paso 3 mal colocado o una variable sin poner. |
| El login vuelve siempre a empezar | `COOKIE_DOMAIN` debe ser el dominio común de los dos subdominios. |
| Te has quedado bloqueado | Tras 3 fallos en 2 minutos, el usuario se bloquea 15 minutos. Espera. |
| Has perdido el móvil | Con acceso al servidor, sigue `authelia storage user totp delete TU_USUARIO` en la terminal de Authelia y vuelve a registrarlo. |
| La descarga falla | `SUUNTO_SESSION_KEY` puede haber caducado. Ejecuta `./actualizar.sh` en la terminal del contenedor `app` para ver el motivo. |
