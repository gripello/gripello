# syntax=docker/dockerfile:1.7
FROM golang:1.27.2-trixie@sha256:e58d6f83b3416618d8bcac2b3dde1b7f7e3c4a77d25e88637f8bbae81536c48d AS go-deps
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
# DB-backed tests skip without a reachable database, so the stage runs its own PostgreSQL 18 (PGDG, like the runtime image).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips-tools postgresql-common \
 && sed -i 's/^#\?create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-18 \
 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS= GOARCH= go install gotest.tools/gotestsum@v1.13.0
COPY backend/testdata ./testdata
COPY i18n/locales/*.json /src/i18n/locales/
COPY shared /src/shared
ENV GRIPELLO_TEST_DSN=postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=tmpfs,target=/var/lib/postgresql/test \
    chown postgres /var/lib/postgresql/test \
 && su postgres -c '/usr/lib/postgresql/18/bin/initdb -D /var/lib/postgresql/test -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null' \
 && su postgres -c "/usr/lib/postgresql/18/bin/pg_ctl -D /var/lib/postgresql/test -w -l /tmp/postgres.log \
      -o '-c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300' start" \
 && mkdir /out && { gotestsum --junitfile /out/junit.xml -- -timeout 30m -parallel 4 ./...; echo $? > /out/exit-code; }

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

FROM node:26.10.0-trixie@sha256:9965105b7a4e201d7f07268402bb4971670592b46c9b9058cc643961199a1ab6 AS ui-deps
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

FROM ui-deps AS typecheck
COPY . .
RUN mkdir /out && { yarn typecheck > /out/typecheck.txt 2>&1; echo $? > /out/exit-code; }; cat /out/typecheck.txt

FROM scratch AS typecheck-results
COPY --from=typecheck /out /

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
ENV NODE_ENV=production NITRO_PRESET=node-cluster APP_VERSION=${APP_VERSION}
RUN yarn build
COPY .docker/third-party-notices.mts ./.docker/
COPY --from=go-build /out/third-party-notices-go.txt /tmp/
RUN { node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt; } \
      > .output/public/third-party-notices.txt

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33
# pg_dump/pg_restore must match the PostgreSQL 18 server; trixie ships 17, so the client comes from PGDG.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx openssl ca-certificates libcap2-bin libvips-tools postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && setcap cap_net_bind_service=+ep /usr/sbin/nginx \
 && rm -rf /var/lib/apt/lists/* /var/log/nginx /etc/nginx/sites-* /etc/nginx/conf.d \
    /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data/storage /data/backups /etc/nginx/ssl \
 && touch /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf \
 && chown node:node /data /data/storage /data/backups /etc/nginx/ssl /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf

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
    BLOB_DIR=/data/storage BACKUP_DIR=/data/backups BLOB_ACCEL_PREFIX=/_blob/ VIPS_BLOCK_UNTRUSTED=1 PATH=/app/bin:$PATH
WORKDIR /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

EXPOSE 80 443
ENTRYPOINT ["/app/entrypoint.sh"]
