FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# SvelteKit imports server modules during route analysis; these build-only values are not copied into the runtime image.
ENV APP_ORIGIN=http://localhost:5173 \
    DATABASE_URL=postgresql://lfys:lfys_dev_only@localhost:5432/lfys \
    BETTER_AUTH_URL=http://localhost:5173 \
    BETTER_AUTH_SECRET=build-only-placeholder-secret-32-chars
RUN pnpm build

FROM node:24-alpine AS production-dependencies

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS app

ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build
EXPOSE 5173
CMD ["node", "build/index.js"]
