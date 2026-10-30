FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace=api --include-workspace-root

COPY apps/api apps/api
RUN npm run build --workspace=api
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
