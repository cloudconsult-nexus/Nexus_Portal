FROM node:20-slim AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/index.js"]
