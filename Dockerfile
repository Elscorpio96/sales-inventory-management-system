# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
COPY server server
COPY web web
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DB_PATH=/app/data/inventory.db WEB_DIST=/app/web/dist TZ=Africa/Lagos
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
WORKDIR /app/server
EXPOSE 4000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
