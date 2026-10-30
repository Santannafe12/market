FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=web --include-workspace-root

COPY apps/web apps/web
# The room imports the shared sync rules straight from the API source.
COPY apps/api/src/realtime/auction-sync.ts apps/api/src/realtime/auction-sync.ts
# Empty means same origin: nginx below proxies /api and /socket.io to the API container.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
