# Zarin AI worker. Liara: a Docker app listening on $PORT (default 8000),
# with a disk mounted at /data for the job database.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 \
    ZH_WORKER_DB=/data/worker.db ZH_LLM_COST_LOG=/data/cost-log.jsonl
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker ./worker
RUN useradd --create-home --uid 10001 worker && mkdir -p /data && chown worker /data
USER worker
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/health')"
CMD ["python", "-m", "worker", "serve"]
