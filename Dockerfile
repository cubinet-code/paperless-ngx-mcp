# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# --http listens on 127.0.0.1 by default, which Docker's port mapping can't
# reach. Listen on every interface inside the container; limit exposure with
# the host-side mapping (e.g. -p 127.0.0.1:3000:3000). Ignored in stdio mode.
ENV PAPERLESS_MCP_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
USER node
# stdio by default (docker run -i). For Streamable HTTP pass: --http --port 3000
ENTRYPOINT ["node", "build/index.js"]
