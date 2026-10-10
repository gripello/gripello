# syntax=docker/dockerfile:1.7
FROM golang:1.27.1-trixie@sha256:433790e515d27dc6003e847e644cc0af956985cf315c1c58a3b73ee2dd305183 AS go-deps
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH}
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY backend/cmd ./cmd
COPY backend/internal ./internal

FROM go-deps AS go-test
RUN apt-get update && apt-get install -y --no-install-recommends libvips-tools && rm -rf /var/lib/apt/lists/*
COPY backend/testdata ./testdata
COPY i18n/locales/*.json /src/i18n/locales/
COPY shared /src/shared
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    mkdir /out && { go run gotest.tools/gotestsum@v1.13.0 --junitfile /out/junit.xml -- -timeout 30m ./...; echo $? > /out/exit-code; }

FROM scratch AS go-results
COPY --from=go-test /out /

FROM go-deps AS go-build
ARG APP_VERSION
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags="-s -w -X gripello/internal/platform/config.Version=${APP_VERSION:-dev}" -o /out/gripello ./cmd/gripello
COPY <<'EOF' /go-licenses.tpl
{{ range . }}{{ .Name }}@{{ .Version }} ({{ .LicenseName }})

{{ .LicenseText }}

------------------------------------------------------------------------------

{{ end }}
EOF
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS= GOARCH= go run github.com/google/go-licenses/v2@v2.0.1 report ./... \
      --ignore gripello --template /go-licenses.tpl > /out/third-party-notices-go.txt

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
COPY .docker/third-party-notices.mts ./.docker/
COPY --from=go-build /out/third-party-notices-go.txt /tmp/
RUN { node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt; } \
      > public/third-party-notices.txt
COPY app ./app
ARG APP_VERSION
ENV NODE_ENV=production NITRO_PRESET=node-cluster APP_VERSION=${APP_VERSION}
RUN yarn build

FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx openssl ca-certificates libcap2-bin libvips-tools \
 && setcap cap_net_bind_service=+ep /usr/sbin/nginx \
 && rm -rf /var/lib/apt/lists/* /var/log/nginx /etc/nginx/sites-* /etc/nginx/conf.d \
    /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data/storage /etc/nginx/ssl \
 && touch /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf \
 && chown node:node /data /data/storage /etc/nginx/ssl /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf

COPY .docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 .docker/docker-entrypoint.sh /app/entrypoint.sh
COPY .docker/healthcheck.mjs /app/healthcheck.mjs
COPY --from=go-build /out/gripello /app/bin/gripello
COPY i18n/locales/*.json /app/locales/
COPY --from=ui-build /app/.output /app/ui
COPY LICENSE /app/LICENSE

LABEL org.opencontainers.image.licenses="BUSL-1.1" \
      org.opencontainers.image.source="https://github.com/gripello/gripello"

ARG APP_VERSION
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} LOCALES_DIR=/app/locales \
    BLOB_DIR=/data/storage BLOB_ACCEL_PREFIX=/_blob/ VIPS_BLOCK_UNTRUSTED=1 PATH=/app/bin:$PATH
WORKDIR /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

EXPOSE 80 443
ENTRYPOINT ["/app/entrypoint.sh"]
