# Production image for the web app and the background worker.
#   docker build -t ai-creator-studio .
#   one service (default): docker run --env-file .env.production -p 3000:3000 -v studio-storage:/app/.storage ai-creator-studio
#     applies migrations, then runs the web app and the worker together (npm run start:all)
#   or split them:
#     web:    docker run --env-file .env.production -p 3000:3000 ai-creator-studio npm start
#     worker: docker run --env-file .env.production ai-creator-studio npm run worker
#     migrations (once per release): docker run --env-file .env.production ai-creator-studio npm run db:deploy
FROM node:22-bookworm-slim AS base
# ffmpeg provides ffprobe for video validation; openssl is required by Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/.storage && chown node:node /app/.storage
# The entrypoint fixes ownership of a mounted storage disk, then runs everything as `node`.
ENTRYPOINT ["/app/docker/entrypoint.sh"]
EXPOSE 3000
CMD ["node", "scripts/start-all.mjs"]
