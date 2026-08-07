FROM node:20-bookworm-slim

WORKDIR /app

# Contexto = raiz SaaS-Demo (paridade RC1: migrate:full + master-contract compilado)
COPY VERSION /app/VERSION
COPY supabase_full_schema.sql /app/supabase_full_schema.sql
COPY supabase /app/supabase
COPY shared/master-contract /app/shared/master-contract
COPY backend/package.json backend/package-lock.json* /app/backend/

WORKDIR /app/backend
RUN npm install --include=dev

COPY backend/ /app/backend/
RUN npm run release

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
