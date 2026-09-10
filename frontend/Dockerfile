# Frontend image. Build from services/ (character-kit, voice-kit, playground assets):
#   docker build -f services/oc-controller/frontend/Dockerfile -t oc-controller-frontend:latest services
FROM node:22-bookworm-slim AS build
WORKDIR /src

COPY oc-controller/frontend/package.json oc-controller/frontend/package-lock.json /src/oc-controller/frontend/
COPY dev-vrm/tsconfig.base.json /src/dev-vrm/tsconfig.base.json
COPY dev-vrm/packages/character-kit /src/dev-vrm/packages/character-kit
COPY dev-vrm/packages/voice-kit /src/dev-vrm/packages/voice-kit

# Vite aliases kits to source; their imports resolve from each package's node_modules.
WORKDIR /src/dev-vrm/packages/character-kit
RUN npm install
WORKDIR /src/dev-vrm/packages/voice-kit
RUN npm install

WORKDIR /src/oc-controller/frontend
RUN npm ci

COPY oc-controller/frontend/index.html oc-controller/frontend/tsconfig.json oc-controller/frontend/vite.config.ts ./
COPY oc-controller/frontend/src ./src
COPY dev-vrm/apps/playground/public/assets /src/dev-vrm/apps/playground/public/assets
RUN npm run build

FROM nginx:alpine
COPY oc-controller/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/oc-controller/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
