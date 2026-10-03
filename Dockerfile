# syntax=docker/dockerfile:1.7
FROM golang:1.27.1-trixie@sha256:433790e515d27dc6003e847e644cc0af956985cf315c1c58a3b73ee2dd305183 AS pb-deps
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH}
WORKDIR /src
COPY pocketbase/go.mod pocketbase/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY pocketbase/main.go ./
COPY pocketbase/hooks ./hooks

FROM pb-deps AS pb-test
COPY pocketbase/migrations_test.go ./
COPY pocketbase/pb_migrations ./pb_migrations
COPY pocketbase/testdata ./testdata
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    mkdir /out && { go run gotest.tools/gotestsum@v1.13.0 --junitfile /out/junit.xml ./...; echo $? > /out/exit-code; }

FROM scratch AS go-results
COPY --from=pb-test /out /

FROM pb-deps AS pb-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/pocketbase

FROM node:26.10.0-trixie@sha256:a723b54c35a76e947095a20a67d39585bb09c862e6b1adeb8a9f518f95e34fb0 AS ui-deps
WORKDIR /app
RUN npm install -g corepack --force && corepack enable
COPY .yarnrc.yml package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable --inline-builds

FROM ui-deps AS unit-test
COPY . .
RUN mkdir /out && { yarn test --reporter=default --reporter=junit --outputFile.junit=/out/junit.xml; echo $? > /out/exit-code; }

FROM scratch AS vitest-results
COPY --from=unit-test /out /

FROM ui-deps AS ui-build
COPY nuxt.config.ts ./
COPY postcss ./postcss
COPY types ./types
COPY i18n ./i18n
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY app ./app
ARG APP_VERSION
ENV NODE_ENV=production NITRO_PRESET=node-server APP_VERSION=${APP_VERSION}
RUN yarn build

FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx openssl ca-certificates libcap2-bin \
 && setcap cap_net_bind_service=+ep /usr/sbin/nginx \
 && rm -rf /var/lib/apt/lists/* /var/log/nginx /etc/nginx/sites-* /etc/nginx/conf.d \
    /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /pb/pb_data /pb/pb_migrations /etc/nginx/ssl \
 && touch /etc/nginx/real-ip.conf \
 && chown node:node /pb/pb_data /pb/pb_migrations /etc/nginx/ssl /etc/nginx/real-ip.conf

COPY .docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 .docker/docker-entrypoint.sh /app/entrypoint.sh
COPY .docker/healthcheck.mjs /app/healthcheck.mjs
COPY --from=pb-build /out/pocketbase /pb/pocketbase
COPY --chown=node:node pocketbase/pb_migrations /pb/pb_migrations
COPY --from=ui-build /app/.output /app/ui

ARG APP_VERSION
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

EXPOSE 80 443
ENTRYPOINT ["/app/entrypoint.sh"]
