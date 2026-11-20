# The downloader: pipeline/fetch.py with yt-dlp, run by cron on the homeserver
# (see compose.yml). Built from the repo's root:
#   docker compose -f downloader/compose.yml build
FROM node:24-bookworm-slim

# yt-dlp solves YouTube's JavaScript challenges with node; ssh reaches the server.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ADD https://github.com/astral-sh/uv/releases/download/0.13.6/uv-x86_64-unknown-linux-gnu.tar.gz /tmp/uv-amd64.tar.gz
ADD https://github.com/astral-sh/uv/releases/download/0.13.6/uv-aarch64-unknown-linux-gnu.tar.gz /tmp/uv-arm64.tar.gz
RUN tar -xzf /tmp/uv-$TARGETARCH.tar.gz -C /usr/local/bin --strip-components=1 && rm /tmp/uv-*.tar.gz
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-default-groups --group download
COPY pipeline/ pipeline/

ENTRYPOINT ["/app/.venv/bin/python", "-m", "pipeline.fetch"]
CMD ["--data", "/data"]
