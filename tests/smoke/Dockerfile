FROM python:3.12-slim

# Runtime setup
WORKDIR /usr/src/app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Smoke test source
COPY services/pmgen ./pmgen
COPY tests/smoke ./smoke

RUN pip install --no-cache-dir ./pmgen ./smoke

# Test entrypoint
CMD ["python", "smoke/src/smoke-test.py"]
