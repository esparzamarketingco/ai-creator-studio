# Production image for both the web app and the background worker.
#   docker build -t ai-creator-studio .
#   web:    docker run --env-file .env.production -p 3000:3000 ai-creator-studio
#   worker: docker run --env-file .env.production ai-creator-studio npm run worker
#   migrations (run once per release): docker run --env-file .env.production ai-creator-studio npm run db:deploy
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
USER node
EXPOSE 3000
CMD ["npm", "start"]
