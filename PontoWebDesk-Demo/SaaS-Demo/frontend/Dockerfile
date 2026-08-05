FROM node:20-bookworm-slim

# npm vem com a imagem oficial (Node 20 → npm 10.x)
WORKDIR /app

COPY shared/master-contract /app/shared/master-contract
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc /app/frontend/

WORKDIR /app/frontend
# Instalação reproduzível a partir do lock (sem --force / sem --legacy-peer-deps)
RUN npm ci --include=dev

COPY frontend/ /app/frontend/

ENV NODE_ENV=development
EXPOSE 3010
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3010", "--strictPort"]
