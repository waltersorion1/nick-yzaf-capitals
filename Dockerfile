FROM node:24.13.1-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/copy-assets.mjs scripts/copy-assets.mjs
RUN npm ci
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public
ARG RELEASE_ID=source
RUN node -e 'const fs=require("node:fs"), id=process.env.RELEASE_ID; if(!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error("Invalid release id"); const p="public/sw.js";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("nycap-public-v5","nycap-public-v5-"+id))'
RUN DATABASE_URL=postgresql://build:unused@localhost:5432/build npm run db:generate && npm run build

FROM build AS migrate
CMD ["node", "deploy/migrate.mjs"]
COPY deploy/migrate.mjs deploy/migrate.mjs

FROM build AS dependencies
RUN npm prune --omit=dev

FROM postgres:17.7 AS backup
RUN apt-get update && apt-get install -y --no-install-recommends age && rm -rf /var/lib/apt/lists/*
COPY deploy/backup.sh /usr/local/bin/nycap-backup
RUN chmod 755 /usr/local/bin/nycap-backup
ENTRYPOINT ["/usr/local/bin/nycap-backup"]

FROM node:24.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=12s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
