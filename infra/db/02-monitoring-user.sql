CREATE USER postgres_exporter WITH PASSWORD 'insecure=dev.only';
GRANT CONNECT ON DATABASE telecom TO postgres_exporter;
GRANT pg_monitor TO postgres_exporter;