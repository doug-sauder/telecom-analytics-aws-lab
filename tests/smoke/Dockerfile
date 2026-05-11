FROM python:3.12-slim

# Runtime setup
WORKDIR /usr/src/app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Smoke test source
COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

# Test entrypoint
CMD ["python", "src/smoke-test.py"]
