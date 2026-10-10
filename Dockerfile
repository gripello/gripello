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
COPY i18n/locales/*.json /i18n/locales/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    mkdir /out && { go run gotest.tools/gotestsum@v1.13.0 --junitfile /out/junit.xml -- -timeout 30m ./...; echo $? > /out/exit-code; }

FROM scratch AS go-results
COPY --from=pb-test /out /

FROM pb-deps AS pb-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/pocketbase
COPY <<'EOF' /go-licenses.tpl
{{ range . }}{{ .Name }}@{{ .Version }} ({{ .LicenseName }})

{{ .LicenseText }}

------------------------------------------------------------------------------

{{ end }}
EOF
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS= GOARCH= go run github.com/google/go-licenses/v2@v2.0.1 report ./... \
      --ignore pocketbase --template /go-licenses.tpl > /out/third-party-notices-go.txt

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

FROM ui-deps AS ui-build
COPY nuxt.config.ts ./
COPY postcss ./postcss
COPY types ./types
COPY i18n ./i18n
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY .docker/third-party-notices.mts ./.docker/
COPY --from=pb-build /out/third-party-notices-go.txt /tmp/
RUN { node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt; } \
      > public/third-party-notices.txt
COPY app ./app
ARG APP_VERSION
ENV NODE_ENV=production NITRO_PRESET=node-cluster APP_VERSION=${APP_VERSION}
RUN yarn build

FROM node:26.10.0-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33
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
COPY i18n/locales/*.json /pb/locales/
COPY --from=ui-build /app/.output /app/ui
COPY LICENSE /app/LICENSE

LABEL org.opencontainers.image.licenses="BUSL-1.1" \
      org.opencontainers.image.source="https://github.com/gripello/gripello"

ARG APP_VERSION
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} PB_LOCALES_DIR=/pb/locales
WORKDIR /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

EXPOSE 80 443
ENTRYPOINT ["/app/entrypoint.sh"]
