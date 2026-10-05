# Zarin Hooshmand backend: PocketBase + this repo's schema and hooks.
#   docker build -t zarin-pocketbase pocketbase/
# If GitHub is unreachable from the build host, put the release zip next to
# this file as `pocketbase.zip`; it is used instead of downloading.
FROM alpine:3.22

ARG PB_VERSION=0.40.4
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates tzdata unzip wget
WORKDIR /pb
# The Dockerfile is listed so the COPY succeeds when pocketbase.zip is absent.
COPY Dockerfile pocketbase.zi[p] /tmp/pb/
RUN if [ ! -f /tmp/pb/pocketbase.zip ]; then \
      wget -q -O /tmp/pb/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip"; \
    fi \
 && unzip -q /tmp/pb/pocketbase.zip pocketbase -d /pb && rm -rf /tmp/pb && chmod +x /pb/pocketbase

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

ENV TZ=Asia/Tehran
EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O - http://127.0.0.1:8090/api/health || exit 1
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations"]
