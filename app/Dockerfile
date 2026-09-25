# Build stage: the VITE_* values are baked into the bundle, so they are build args.
FROM node:26-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .

ARG VITE_API_URL
ARG VITE_GA_MEASUREMENT_ID=
ARG VITE_DEV_FAKE_AUTH=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID \
    VITE_DEV_FAKE_AUTH=$VITE_DEV_FAKE_AUTH
RUN npm run build

# Runtime stage: Nitro's output traces its own node_modules, so nothing else is needed.
FROM node:26-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
