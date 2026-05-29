FROM mcr.microsoft.com/playwright/python:v1.53.0-noble

WORKDIR /app
RUN pip install --no-cache-dir playwright==1.53.0
COPY workers/meta-ad-library-collector/server.py ./server.py

ENV META_COLLECTOR_HOST=0.0.0.0
ENV META_COLLECTOR_PORT=9100
ENV PYTHONUNBUFFERED=1

EXPOSE 9100
CMD ["python", "server.py"]

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9100/health', timeout=5)"
