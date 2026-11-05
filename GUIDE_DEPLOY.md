# Publish the app on your domain with a login

[Español](GUIA_DESPLIEGUE.md) · **English**

By default the app only opens on your own computer, with no login, and **you don't need anything in this guide**. Follow these steps only if you want to open it from anywhere on your own domain.

You will sign in with a **username, a password and a 6-digit code** that changes every 30 seconds. The codes are standard TOTP, so any authenticator app works (Oracle Mobile Authenticator, Google Authenticator, Aegis…).

```
Internet → Traefik (HTTPS) → Authelia (password + code) → Suunto Stats
```

## Which server should I use?

**Any server** that can run Docker will do. We recommend [**Dokploy**](https://dokploy.com), a self-hosted alternative to Vercel: you install it on your own server and it gives you deployments from GitHub and automatic HTTPS certificates. This guide and `docker-compose.yml` are set up for Dokploy. If you use something else, see [Without Dokploy](#without-dokploy).

## What you need

- A server with Dokploy (or [without it](#without-dokploy)).
- A domain with two subdomains pointing to the server (DNS `A` record), for example:
  - `suunto.yourdomain.com`: the app.
  - `auth.yourdomain.com`: the login screen.
- Docker on any machine, to generate your password hash (the server's is fine).

## 1. Create the application in Dokploy

1. In your project: **Create Service → Compose**.
2. As the source, your copy of the repository on GitHub, branch `main`, path `./docker-compose.yml`.

> The domains are set in `docker-compose.yml`: **do not also add them** in the **Domains** tab.

## 2. Set the variables

In the **Environment** tab, with your values:

```bash
SUUNTO_DOMAIN=suunto.yourdomain.com
AUTH_DOMAIN=auth.yourdomain.com
COOKIE_DOMAIN=yourdomain.com

AUTH_PROXY_SECRET=...
AUTHELIA_SESSION_SECRET=...
AUTHELIA_STORAGE_ENCRYPTION_KEY=...
AUTHELIA_JWT_SECRET=...

SUUNTO_TIMEZONE=Europe/Madrid
SUUNTO_SESSION_KEY=...
GEMINI_API_KEY=...
# TP_AUTH_COOKIE=...
```

- **The four secrets** are random strings, a different one for each. Generate each with:

  ```bash
  openssl rand -hex 32
  ```

- **`SUUNTO_SESSION_KEY`** is the `sessionkey` field of the file `suuntool login` creates on your computer (`~/.config/suuntool/session.json`). Treat it like a password. If it expires, log in again and update it here.
- **The AI and TrainingPeaks** are set as in `.env.example`. `TP_AUTH_COOKIE` is optional.

## 3. Create the Authelia files

In **Advanced → Mounts**, add two **File Mounts**:

| Path | Content |
|---|---|
| `authelia/configuration.yml` | Copy [`deploy/authelia/configuration.yml`](deploy/authelia/configuration.yml) as is |
| `authelia/users_database.yml` | Start from [`deploy/authelia/users_database.example.yml`](deploy/authelia/users_database.example.yml), with your details |

To generate your password hash (it asks for the password on screen):

```bash
docker run --rm -it authelia/authelia:4.39 authelia crypto hash generate argon2
```

> Check that the files end up in `../files/authelia/`, the folder `docker-compose.yml` mounts. If Dokploy puts them elsewhere, adjust that line.

## 4. Check Traefik and deploy

`docker-compose.yml` uses the `web` and `websecure` entrypoints and the `letsencrypt` certificate resolver, the usual names on Dokploy. Check them in **Traefik File System → traefik.yml**. If your server uses others, change them in the labels.

Then click **Deploy**.

## 5. Register your code

1. Open `https://suunto.yourdomain.com`: it takes you to the login.
2. Sign in with your username and password, and choose to register a **TOTP** device.
3. Authelia asks for a one-time verification code. With no email configured, it writes it to a file. Open the terminal of the `authelia` container in Dokploy (or `docker exec` on the server) and read it:

   ```bash
   cat /data/notification.txt
   ```

4. Scan the QR code with your authenticator app and enter the code it gives you.

Check that it works: **Ajustes → Acceso** should say «Protegido con Authelia · has entrado como …» (the app's interface is in Spanish).

## 6. Download your data

The app is empty the first time. Click the **refresh button** next to SUUNTO/STATS. Your data is stored in a volume and survives each deployment.

To update it automatically, create a **Schedule Job** of type Compose in Dokploy, on the `app` service, with the command `./actualizar.sh`.

## Without Dokploy

**With Docker and Traefik**, the same `docker-compose.yml` works with these changes:

1. Replace the `dokploy-network` network with your Traefik's network.
2. Create a `.env` next to `docker-compose.yml` with the variables from step 2.
3. Create the `../files/authelia/` folder with the files from step 3.
4. Check the names from step 4 and start it with `docker compose up -d --build`.

**With another proxy (Nginx, Caddy…)** you have to write its configuration, because none is provided. The app requires the same with any of them:

- `AUTH_MODE=authelia` and `AUTH_PROXY_SECRET` in its variables.
- A proxy that checks the login and adds the user (`Remote-User`) and the secret (`X-Auth-Proxy-Secret`) to each request, replacing whatever the browser sends.
- No way of reaching the app without going through that proxy.

## Security

- **Two locks.** Traefik goes through Authelia and adds a secret (`AUTH_PROXY_SECRET`) that the app requires. Without it, the app rejects the request even if someone makes up the user header.
- **No open ports.** Do not add `ports:` to `app`: it must only be reachable through Traefik.
- **If something is missing, access is denied.** Without `AUTH_MODE=authelia`, or without the secret, the app rejects all outside access.
- **Your data and keys move to the server:** the Suunto session, the TrainingPeaks cookie and the AI key. Also protect the Dokploy panel with its two-factor authentication and keep the server up to date.
- **None of this goes in the repository:** neither Dokploy's `.env` nor `users_database.yml` should be uploaded to GitHub.

## Good to know

- **What is saved in the browser is not shared between devices:** shoes, settings, your own workouts and AI proposals. Move them with **Ajustes → Copia de seguridad**.
- **If the session expires** while the app is open, reload the page to sign in again.

## Troubleshooting

| What happens | What to check |
|---|---|
| «Acceso no permitido» when opening the domain | Check that `AUTH_PROXY_SECRET` has at least 32 characters and the Traefik labels are intact. |
| Certificate error or 404 | The DNS of both subdomains, and the `websecure` and `letsencrypt` names from step 4. |
| Authelia does not start | Its logs in Dokploy. Usually a misplaced file from step 3 or a missing variable. |
| The login keeps starting over | `COOKIE_DOMAIN` must be the domain both subdomains share. |
| You are locked out | After 3 failures in 2 minutes, the user is locked for 15 minutes. Wait. |
| You lost your phone | With server access, run `authelia storage user totp delete YOUR_USER` in the Authelia terminal and register again. |
| The download fails | `SUUNTO_SESSION_KEY` may have expired. Run `./actualizar.sh` in the `app` container terminal to see why. |
