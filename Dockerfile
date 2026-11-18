# BloomLoop — production image.
#
# Node 20 on purpose: the project report names Node 20, and @supabase/supabase-js
# is pinned to 2.45.4 because newer releases require a native WebSocket (Node 22+)
# that this project has no use for. Keep the pair together.

# ---- build: install everything, compile the client ------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# ---- run: server + built client only --------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY client/package.json client/
COPY server/package.json server/
# The client is already built; only the server's runtime deps ship.
RUN npm install --omit=dev --workspace server --include-workspace-root --no-audit --no-fund \
  && npm cache clean --force

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# Koyeb injects PORT; config.js reads it and falls back to 5050 locally.
ENV PORT=8000
EXPOSE 8000

CMD ["node", "server/src/index.js"]
