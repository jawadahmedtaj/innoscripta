FROM node:24.20.0-bookworm-slim AS toolchain
RUN npm install --global npm@11.19.0
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .

FROM toolchain AS checks
RUN npm run typecheck && npm run lint && npm test

FROM toolchain AS build
RUN npm run build

FROM node:24.20.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
COPY --from=build /app/scripts/serve.mjs ./scripts/serve.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/serve.mjs"]
