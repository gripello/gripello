# syntax=docker/dockerfile:1.7
FROM golang:1.27.2-trixie@sha256:47667934874913a449b96faa7ef4777fa285d9ec29126ee80ed61c45b7cccf0e AS go-deps
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH}
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
COPY backend/tools/go.mod backend/tools/go.sum ./tools/
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download && go mod download -modfile=tools/go.mod
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
 && mkdir /out && { GOOS= GOARCH= go tool -modfile=tools/go.mod gotestsum --junitfile /out/junit.xml -- -timeout 30m -parallel 4 ./...; echo $? > /out/exit-code; }

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
    GOOS= GOARCH= go tool -modfile=tools/go.mod go-licenses report ./... \
      --ignore gripello --template /go-licenses.tpl > /out/third-party-notices-go.txt

FROM node:26.11.1-trixie@sha256:32fa97f3363975684b08bf4e8a68a47c7905175cc20275b50b974bbd02aba731 AS ui-deps
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
# yarn typecheck fetches vue-tsc and TypeScript through npx; the cache keeps them across builds.
RUN --mount=type=cache,target=/root/.npm mkdir /out && { yarn typecheck > /out/typecheck.txt 2>&1; echo $? > /out/exit-code; }; cat /out/typecheck.txt

FROM scratch AS typecheck-results
COPY --from=typecheck /out /

# Native Android app (Capacitor): debug APK on every build.
FROM ui-deps AS android
ARG ANDROID_CMDLINE_TOOLS=commandlinetools-linux-16111833_latest.zip
ARG ANDROID_CMDLINE_TOOLS_SHA1=e025545c62a8e64c7559119566a569fb1dec5f60
ENV ANDROID_HOME=/opt/android-sdk
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jdk-headless unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSLo /tmp/tools.zip https://dl.google.com/android/repository/$ANDROID_CMDLINE_TOOLS \
 && echo "$ANDROID_CMDLINE_TOOLS_SHA1  /tmp/tools.zip" | sha1sum -c - \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/tools.zip -d /tmp/tools && mv /tmp/tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm -rf /tmp/tools /tmp/tools.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" >/dev/null
COPY capacitor.config.json ./
COPY public/offline.html public/icon-192.png ./public/
# Only the Android shell, so iOS changes leave these layers cached.
COPY mobile/www ./mobile/www
COPY mobile/android ./mobile/android
RUN --mount=type=cache,target=/root/.gradle \
    mkdir /out && npx cap sync android && cd mobile/android \
 && { ./gradlew --no-daemon -q assembleDebug; echo $? > /out/exit-code; } \
 && cp app/build/outputs/apk/debug/app-debug.apk /out/gripello-debug.apk 2>/dev/null; true

FROM scratch AS android-results
COPY --from=android /out /

# Release commits: AAB signed with the upload key, published to a Play track (Play App Signing re-signs it); a failed upload still exports the AAB.
FROM android AS android-release
ARG PLAY_TRACK
ARG PLAY_STATUS
COPY .docker/play-publish.mts ./.docker/
RUN --mount=type=cache,target=/root/.gradle \
    --mount=type=secret,id=android_keystore,required=true \
    --mount=type=secret,id=android_keystore_password,required=true \
    --mount=type=secret,id=android_key_password,required=true \
    --mount=type=secret,id=google_services,required=true,target=/app/mobile/android/app/google-services.json \
    --mount=type=secret,id=play_service_account,required=true \
    cd mobile/android \
 && ANDROID_KEYSTORE=/run/secrets/android_keystore ANDROID_KEY_ALIAS=upload \
    ANDROID_KEYSTORE_PASSWORD="$(cat /run/secrets/android_keystore_password)" \
    ANDROID_KEY_PASSWORD="$(cat /run/secrets/android_key_password)" \
    ./gradlew --no-daemon -q bundleRelease \
 && mkdir -p /release && cp app/build/outputs/bundle/release/app-release.aab /release/gripello-release.aab \
 && { node /app/.docker/play-publish.mts /run/secrets/play_service_account app.gripello /release/gripello-release.aab "$PLAY_TRACK" "$PLAY_STATUS"; echo $? > /release/exit-code; }

FROM scratch AS android-release-results
COPY --from=android-release /release /

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
# capjs-core only imports esbuild and the obfuscator for instrumented challenges, which /api/cap never asks for; rm -r fails the build once they move.
RUN yarn build \
 && rm -r .output/server/node_modules/esbuild .output/server/node_modules/@esbuild \
    .output/server/node_modules/javascript-obfuscator .output/server/node_modules/@javascript-obfuscator
COPY .docker/third-party-notices.mts ./.docker/
COPY --from=go-build /out/third-party-notices-go.txt /tmp/
RUN { node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt; } \
      > .output/public/third-party-notices.txt

FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS pg-client
# pg_dump/pg_restore/psql must match the PostgreSQL 18 server; trixie ships 17, so the client comes from PGDG.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && mkdir -p /out/bin /out/lib \
 && cp /usr/lib/postgresql/18/bin/pg_dump /usr/lib/postgresql/18/bin/pg_restore /usr/lib/postgresql/18/bin/psql /out/bin/ \
 && cp -L /usr/lib/*-linux-gnu/libpq.so.5 /usr/lib/*-linux-gnu/libreadline.so.8 /out/lib/

# Only the binaries of node and the PostgreSQL client: their packages bring npm, perl and gnupg along.
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
COPY --from=ui-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=pg-client /out/bin/ /usr/local/bin/
COPY --from=pg-client /out/lib/ /usr/local/lib/
# libvips-tools needs python3 only for vipsprofile; the vips CLI alone comes out of its package.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx openssl ca-certificates libcap2-bin libvips42t64 \
 && cd /tmp && apt-get download libvips-tools && dpkg-deb -x libvips-tools_*.deb vips-tools \
 && mv vips-tools/usr/bin/vips /usr/local/bin/ && rm -rf vips-tools libvips-tools_*.deb \
 && ldconfig \
 && setcap cap_net_bind_service=+ep /usr/sbin/nginx \
 && useradd --uid 1000 --user-group --create-home node \
 && rm -rf /var/lib/apt/lists/* /var/log/nginx /etc/nginx/sites-* /etc/nginx/conf.d \
 && mkdir -p /data/storage /data/backups /etc/nginx/ssl \
 && touch /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf \
 && chown node:node /data /data/storage /data/backups /etc/nginx/ssl /etc/nginx/real-ip.conf /etc/nginx/rate-limit.conf \
 && pg_dump --version && psql --version && vips --version && node --version

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
