# Scrapling MCP server — provides Hermes a self-hosted stealth browser tool
# and serves as the verifier path for the orchestrator.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-driver \
    fonts-liberation libnss3 libxss1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir 'scrapling[all]>=0.4.0'

# Pre-warm Camoufox / Playwright stealth runtime
RUN python -c "from scrapling.fetcher import StealthyFetcher; StealthyFetcher.adaptive = True" || true

WORKDIR /app
EXPOSE 9000

# Scrapling ships a built-in MCP server (see Scrapling-Skill docs).
CMD ["python", "-m", "scrapling.mcp", "--port", "9000", "--host", "0.0.0.0"]
