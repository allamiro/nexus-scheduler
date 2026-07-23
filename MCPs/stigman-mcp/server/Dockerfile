# STIG Manager MCP server. Build online, transfer with docker save /
# docker load for air-gapped use — nothing is downloaded at runtime.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Non-root, like the other sidecar services in this repo.
RUN useradd --system --no-create-home mcp
USER mcp

EXPOSE 8005
# Streamable-HTTP MCP endpoint at /mcp
CMD ["python", "server.py"]
