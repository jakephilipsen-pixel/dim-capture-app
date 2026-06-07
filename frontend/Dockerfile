# ---- build stage -----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Build the PWA (tsc -b && vite build → dist/, includes sw.js + manifest).
COPY . .
# API base is baked in at build time. Default "" → api.ts uses a relative /api
# base and the nginx layer below proxies it to the backend (single origin).
# Override only if the API must live on a separate origin.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# SPA + PWA aware nginx config (history fallback, no-cache for the SW).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
# Image-level healthcheck (busybox wget ships in nginx:alpine).
# M4 — use 127.0.0.1 explicitly; busybox resolves `localhost` to ::1 (IPv6)
# first, but nginx listens on IPv4 only, causing false unhealthy reports.
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
