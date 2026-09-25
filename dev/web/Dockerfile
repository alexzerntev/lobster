# Private development harness: this image is not part of Lobster's published package.
FROM node:24
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dev/web/package.json ./dev/web/package.json
COPY ui/package.json ./ui/package.json
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN chown -R node:node /app /opt/corepack
USER node
ENV NODE_ENV=development COREPACK_ENABLE_NETWORK=0 LOBSTER_WEB_HOST=0.0.0.0 LOBSTER_WEB_PORT=5180
WORKDIR /app/dev/web
CMD ["node", "node_modules/tsx/dist/cli.mjs", "watch", "--clear-screen=false", "server.ts"]
