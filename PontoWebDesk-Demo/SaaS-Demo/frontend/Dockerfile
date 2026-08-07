FROM node:20-bookworm-slim

WORKDIR /app

COPY shared/master-contract /app/shared/master-contract
COPY frontend/package.json frontend/package-lock.json* /app/frontend/

WORKDIR /app/frontend
RUN npm install --include=dev

COPY frontend/ /app/frontend/

EXPOSE 3010
# Dev server Vite (demo) — hot reload não é necessário; porta fixa 3010
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3010"]
