# syntax=docker/dockerfile:1

# Build context: the `app/` directory.
#   docker build -t node-service:local app/
ARG NODE_VERSION=20-alpine

# --- Stage 1: build the app and prune to production dependencies ---------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Build metadata: the caller supplies the commit (CI knows it, .git is not in the
# build context) and it ends up in dist/build-info.json, exposed by /info.
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ENV BUILD_COMMIT=${VCS_REF}

# Copied on their own so the dependency layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Stage 2: minimal runtime --------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# Los metadatos se re-declaran en esta etapa: cada etapa tiene sus propios ARG.
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown

# Labels let `docker inspect` identify where the image came from.
LABEL org.opencontainers.image.title="node-service" \
      org.opencontainers.image.description="Hello, world! service with a Basic Auth /secret route" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Only build artifacts cross the stage boundary: no sources, no dev dependencies.
# No .env file is ever copied, so secrets stay outside the image by construction.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Run as the unprivileged `node` user that ships with the base image.
# Port 3000 (not 80) because non-root cannot bind privileged ports; the container
# port is published as 80 on the host.
USER node

EXPOSE 3000

# Uses the app's own /healthz endpoint. Node's global fetch avoids adding curl.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Secrets are injected at runtime (docker run --env-file, --env, or compose env_file)
# and are validated on boot: the service exits if any is missing.
CMD ["node", "dist/index.js"]
