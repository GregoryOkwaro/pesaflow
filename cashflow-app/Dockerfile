FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir gunicorn==23.0.0
COPY app ./app
COPY static ./static
ENV DATABASE_PATH=/data/cashflow.db PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/healthz')"
# SQLite is safest with a single process; threads give concurrency.
CMD ["gunicorn", "-w", "1", "--threads", "8", "-b", "0.0.0.0:8000", "--forwarded-allow-ips=*", "app.web:application"]
