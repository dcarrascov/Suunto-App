# La app en un contenedor, para publicarla en un servidor (GUIA_DESPLIEGUE.md / GUIDE_DEPLOY.md): la web con Node y
# la descarga de datos con Python. Sin .env ni datos: las claves son variables del servidor y los datos, volúmenes.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/venv
COPY fetch/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

ENV PYTHON=/opt/venv/bin/python PYTHONDONTWRITEBYTECODE=1

# Todo como usuario sin privilegios
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npx vite build && mkdir -p public/data fetch/fit

EXPOSE 4173
# Sin AUTH_MODE=authelia, server/auth.ts rechaza todo lo que no venga de la propia máquina
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
