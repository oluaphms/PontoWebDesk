FROM node:20-bookworm-slim

WORKDIR /app

# Dependência local file:../shared/master-contract (fonte .ts — runtime via tsx)
COPY shared/master-contract /app/shared/master-contract
COPY backend/package.json backend/package-lock.json* /app/backend/

WORKDIR /app/backend
RUN npm install --include=dev

COPY backend/ /app/backend/

ENV NODE_ENV=development
EXPOSE 3000
# Demo: tsx resolve @pontowebdesk/master-contract (.ts). Evita ERR_UNKNOWN_FILE_EXTENSION no node puro.
CMD ["npx", "tsx", "src/server.ts"]
