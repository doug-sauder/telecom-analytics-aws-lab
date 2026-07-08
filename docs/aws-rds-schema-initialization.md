# AWS RDS Schema Initialization

## 1. Purpose

This runbook explains how to initialize the private Amazon RDS for PostgreSQL
database for the Telecom Analytics AWS Lab. It uses an auditable, one-off Amazon
ECS task on AWS Fargate rather than making the database public or connecting to
it from a workstation.

The task runs in the private application subnets, receives database credentials
from AWS Secrets Manager, verifies the RDS TLS certificate, applies the schema
files in order, and writes its operational output to Amazon CloudWatch Logs.

## 2. Design Decisions

- Keep RDS private and retain its security-group-only access boundary.
- Run initialization from `telecom-analytics-dev-app-sg`, which is already the
  only permitted source for PostgreSQL traffic.
- Use a one-off Fargate task so the migration is repeatable and its exit status
  and logs are retained.
- Inject secrets through the ECS task definition. Do not bake credentials into
  the image or retrieve them during the image build.
- Store the `postgres_exporter` password in a separate Secrets Manager secret.
- Connect with `sslmode=verify-full` and the Amazon RDS CA bundle.
- Use VPC endpoints instead of a NAT gateway for access from the private
  application subnets to ECR, Secrets Manager, CloudWatch Logs, and S3.
- Keep the initializer image and task definition after the first run so later
  schema changes use the same controlled path.

This stage introduces recurring charges for interface VPC endpoints, Secrets
Manager, ECR storage, and CloudWatch Logs. Review current pricing before
creating resources.

## 3. Preconditions

Before creating resources:

1. Complete and verify `docs/aws-rds-console-setup.md`.
2. Confirm that `telecom-analytics-dev` is **Available**, private, and attached
   to `telecom-analytics-dev-db-subnets`.
3. Confirm that the RDS security group permits TCP `5432` only from
   `telecom-analytics-dev-app-sg`.
4. Confirm that the application route table has only the local VPC route.
5. Use an IAM identity that can administer EC2 VPC endpoints, ECR, ECS, IAM,
   Secrets Manager, and CloudWatch Logs.
6. Use a networked workstation or standard CloudShell environment with Git,
   Docker, and AWS CLI access to build and push the initializer image.
7. Keep shell command tracing disabled whenever secret-backed environment
   variables are present. Do not use `set -x`.

Suggested tags are the same as the RDS build:

| Key | Value |
| --- | --- |
| `Project` | `telecom-analytics-aws-lab` |
| `Environment` | `dev` |
| `ManagedBy` | `console` |
| `Owner` | AWS account owner or team name |

## 4. Prepare the SQL and Initializer Image

### 4.1 Remove the Hardcoded Exporter Password

Do not apply `infra/db/02-monitoring-user.sql` while it contains
`insecure=dev.only`. Replace it with a parameterized, idempotent `psql` script:

```sql
\set ON_ERROR_STOP on

-- Require the exporter password to be supplied by the initialization task.
\if :{?exporter_password}
\else
    \echo 'Required psql variable exporter_password was not provided.'
    \quit 3
\endif

BEGIN;

-- Create the login role only when it does not already exist.
SELECT 'CREATE ROLE postgres_exporter LOGIN'
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'postgres_exporter'
)
\gexec

-- Set or rotate the password without embedding it in source control.
SELECT format(
    'ALTER ROLE postgres_exporter WITH LOGIN PASSWORD %L',
    :'exporter_password'
)
\gexec

-- Grant the minimum monitoring permissions required by postgres_exporter.
GRANT CONNECT ON DATABASE telecom TO postgres_exporter;
GRANT pg_monitor TO postgres_exporter;

COMMIT;
```

The initializer passes the secret-backed environment variable to `psql` as
`exporter_password`. Do not enable command echoing in the entrypoint or invoke
`psql` with `--echo-all`.

### 4.2 Define the Initializer Artifacts

Create a dedicated initializer directory in a later implementation change:

```text
infra/aws/db-init/
├── Dockerfile
├── entrypoint.sh
└── validate.sql
```

The image must contain:

- A PostgreSQL 18 `psql` client.
- `infra/db/01-schema.sql`.
- The corrected `infra/db/02-monitoring-user.sql`.
- The current Amazon RDS global CA bundle.
- A validation script that does not print credentials.

Pin the container base image by digest. Build the image for the CPU architecture
declared in the ECS task definition; `linux/amd64` is the simplest portable
choice for this lab.

### 4.3 Define Entrypoint Behavior

The entrypoint must use explicit control flow and stop on the first failure:

1. Verify that `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and
   `POSTGRES_EXPORTER_PASSWORD` are present without printing their values.
2. Set `PGSSLMODE=verify-full`.
3. Set `PGSSLROOTCERT` to the bundled RDS CA file.
4. Test the database connection with `psql --no-password`.
5. Apply `01-schema.sql` with `ON_ERROR_STOP=1`.
6. Apply `02-monitoring-user.sql` with `ON_ERROR_STOP=1` and the
   `exporter_password` variable.
7. Run `validate.sql` with `ON_ERROR_STOP=1`.
8. Exit nonzero if any command fails and zero only after validation succeeds.

Do not place the password in a connection URI because URI encoding and log
handling are easy to get wrong. Use libpq environment variables.

### 4.4 Required Validation Queries

The validation script must verify at least:

```sql
-- Confirm the task is connected to the intended database over TLS.
SELECT current_database(), current_user;
SELECT ssl, version, cipher
FROM pg_stat_ssl
WHERE pid = pg_backend_pid();

-- Confirm the schema, table, views, and extension exist.
SELECT to_regnamespace('analytics') AS analytics_schema;
SELECT to_regclass('analytics.pm_events') AS pm_events_table;
SELECT to_regclass('analytics.v_kpi_utilization_1m') AS utilization_view;
SELECT to_regclass('analytics.v_kpi_utilization_1m_by_entity') AS entity_view;
SELECT extname
FROM pg_extension
WHERE extname = 'pgcrypto';

-- Confirm the monitoring role and membership without exposing its password.
SELECT
    rolname,
    rolcanlogin,
    pg_has_role(rolname, 'pg_monitor', 'member') AS has_pg_monitor
FROM pg_roles
WHERE rolname = 'postgres_exporter';
```

The task must treat a missing object, a false TLS result, or missing
`pg_monitor` membership as a validation failure rather than merely printing it.

## 5. Create the Exporter Secret

1. Open **Secrets Manager > Store a new secret**.
2. Choose **Other type of secret**.
3. Add two key/value entries:
   - `username`: `postgres_exporter`
   - `password`: a generated password of at least 32 characters
4. Use the default AWS-managed Secrets Manager KMS key unless the project later
   adopts a customer-managed key.
5. Name the secret `telecom-analytics/dev/postgres-exporter`.
6. Apply the standard project tags.
7. Do not enable automatic rotation yet. Rotation requires a workflow that also
   updates the PostgreSQL role password.
8. Record the secret ARN, but never record its value.

The existing RDS-managed secret remains the source for the master username,
password, host, and port. Do not create a second copy of the master password.

Record the exporter secret ARN in a private local copy, not in the public
repository.

## 6. Create Private AWS Service Access

### 6.1 Create the Endpoint Security Group

1. Open **VPC > Security groups > Create security group**.
2. Name it `telecom-analytics-dev-endpoints-sg` in the lab VPC.
3. Add one inbound rule:
   - Protocol and port: HTTPS, TCP `443`
   - Source: `telecom-analytics-dev-app-sg`
4. Leave the default outbound rule and apply the standard tags.

Do not reuse the RDS security group for VPC endpoints.

### 6.2 Create Interface Endpoints

Create these interface VPC endpoints in the lab VPC:

| Service | Endpoint name | Private DNS |
| --- | --- | --- |
| `com.amazonaws.us-east-1.ecr.api` | `telecom-analytics-dev-ecr-api-vpce` | Enabled |
| `com.amazonaws.us-east-1.ecr.dkr` | `telecom-analytics-dev-ecr-dkr-vpce` | Enabled |
| `com.amazonaws.us-east-1.secretsmanager` | `telecom-analytics-dev-secrets-vpce` | Enabled |
| `com.amazonaws.us-east-1.logs` | `telecom-analytics-dev-logs-vpce` | Enabled |

For each endpoint:

1. Select the lab VPC.
2. Select both application subnets.
3. Attach only `telecom-analytics-dev-endpoints-sg`.
4. Enable private DNS.
5. Apply the standard tags.

Selecting both application subnets provides an endpoint network interface in
both Availability Zones and incurs an hourly charge for each endpoint/AZ pair.

### 6.3 Create the S3 Gateway Endpoint

1. Create a gateway endpoint for `com.amazonaws.us-east-1.s3`.
2. Select the lab VPC.
3. Associate only `telecom-analytics-dev-app-rt` initially.
4. Use the default full-access policy for the first lab pass.
5. Name it `telecom-analytics-dev-s3-vpce` and apply the standard tags.

ECR stores image layers in S3. The S3 gateway endpoint is therefore required
even though the initializer does not directly call S3. Gateway endpoints do not
incur an hourly endpoint charge.

### 6.4 Verify Endpoint Routing

Confirm that:

- The application route table still has no `0.0.0.0/0` route.
- It now has an AWS-managed S3 prefix-list route targeting the S3 endpoint.
- The database route table remains unchanged with only the local VPC route.
- All four interface endpoints report **Available**.
- Private DNS is enabled on every interface endpoint.

## 7. Create the ECR Repository and Push the Image

### 7.1 Create the Repository

1. Open **ECR > Private registry > Repositories > Create repository**.
2. Name it `telecom-analytics/db-init`.
3. Enable immutable image tags.
4. Enable scan on push if available in the selected scanning configuration.
5. Enable AES-256 server-side encryption or use the project KMS policy.
6. Apply the standard tags.

### 7.2 Build and Push

Run from the repository root in a standard, networked shell. Replace
`<account-id>` and `<release-tag>` with recorded values:

```bash
# Authenticate Docker to the private ECR registry.
aws ecr get-login-password --region us-east-1 \
  | docker login \
      --username AWS \
      --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build the initializer for the architecture used by the task definition.
docker build \
  --platform linux/amd64 \
  --tag telecom-analytics-db-init:<release-tag> \
  --file infra/aws/db-init/Dockerfile \
  .

# Tag and push the immutable initializer image.
docker tag \
  telecom-analytics-db-init:<release-tag> \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/db-init:<release-tag>

docker push \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/db-init:<release-tag>
```

Record the pushed image digest. The ECS task definition should ultimately pin
the image by digest, not rely on a mutable tag.

Record image tags and digests in a private local copy when they identify a
specific private ECR build.

## 8. Create IAM Roles

### 8.1 ECS Task Execution Role

Create `telecom-analytics-dev-db-init-execution-role` with:

- Trusted service: `ecs-tasks.amazonaws.com`.
- Managed policy: `AmazonECSTaskExecutionRolePolicy`.
- An inline policy permitting `secretsmanager:GetSecretValue` on only:
  - The RDS-managed master secret ARN.
  - `telecom-analytics/dev/postgres-exporter`.
- `kms:Decrypt` only if either secret uses a customer-managed KMS key.

ECS uses the execution role to pull the image, create the log stream, and
inject task-definition secrets. Application code must not use this role.

### 8.2 ECS Task Role

Create `telecom-analytics-dev-db-init-task-role` trusted by
`ecs-tasks.amazonaws.com` with no permissions for the initial implementation.
The container receives credentials through ECS secret injection and does not
need to call AWS APIs directly.

Keeping execution and task roles separate prevents application code from
inheriting image-pull or secret-injection permissions.

## 9. Create CloudWatch Logging

1. Open **CloudWatch > Log groups > Create log group**.
2. Name it `/ecs/telecom-analytics-dev/db-init`.
3. Set retention to 7 or 14 days for the disposable lab.
4. Use default encryption or the project KMS policy.
5. Apply the standard tags.

The initializer must never print environment variables, secret JSON, generated
SQL containing passwords, or connection URIs.

## 10. Create the ECS Cluster and Task Definition

### 10.1 Create the Cluster

1. Open **ECS > Clusters > Create cluster**.
2. Name it `telecom-analytics-dev`.
3. Use AWS Fargate infrastructure only.
4. Do not enable Container Insights for this first one-off task unless its
   additional telemetry and cost are desired.
5. Apply the standard tags.

### 10.2 Register the Task Definition

Register `telecom-analytics-dev-db-init` with:

| Setting | Value |
| --- | --- |
| Launch type | AWS Fargate |
| Operating system | Linux |
| CPU architecture | `X86_64` |
| Task CPU | `0.25 vCPU` |
| Task memory | `0.5 GB` |
| Network mode | `awsvpc` |
| Execution role | `telecom-analytics-dev-db-init-execution-role` |
| Task role | `telecom-analytics-dev-db-init-task-role` |
| Container name | `db-init` |
| Image | ECR image URI pinned by digest |
| Essential | Yes |
| Log driver | `awslogs` |
| Log group | `/ecs/telecom-analytics-dev/db-init` |
| Log stream prefix | `db-init` |

Add non-secret environment variables:

| Name | Value |
| --- | --- |
| `PGDATABASE` | `telecom` |
| `PGSSLMODE` | `verify-full` |
| `PGSSLROOTCERT` | Path to the bundled RDS CA file |

Map these container secrets from the RDS-managed secret JSON:

| Environment variable | JSON key |
| --- | --- |
| `PGHOST` | `host` |
| `PGPORT` | `port` |
| `PGUSER` | `username` |
| `PGPASSWORD` | `password` |

Map `POSTGRES_EXPORTER_PASSWORD` from the `password` key in
`telecom-analytics/dev/postgres-exporter`.

Do not add a port mapping. This task initiates outbound database connections
and does not accept inbound traffic.

## 11. Run the Initialization Task

1. Open the `telecom-analytics-dev` ECS cluster.
2. Choose **Run new task**.
3. Select the latest `telecom-analytics-dev-db-init` task definition revision.
4. Choose Fargate and platform version `LATEST`.
5. Select the lab VPC.
6. Select both application subnets.
7. Attach only `telecom-analytics-dev-app-sg`.
8. Set **Public IP** to **Turned off**.
9. Set the desired task count to `1`.
10. Enable ECS managed tags and choose **Run task**.

Do not run a second task while the first initialization is active. The SQL is
designed to be rerunnable, but concurrent schema modification is unnecessary
and makes failure diagnosis harder.

## 12. Validate the Result

### 12.1 Inspect ECS and CloudWatch

1. Wait for the task to enter **Stopped**.
2. Confirm that the essential container exit code is `0`.
3. Open the associated CloudWatch log stream.
4. Confirm that both SQL files completed and every validation assertion passed.
5. Confirm that no password, secret JSON, or connection URI appears in logs.

Common failure categories are:

| Symptom | Likely cause |
| --- | --- |
| `CannotPullContainerError` | ECR endpoints, S3 endpoint, endpoint security group, or execution role |
| Secret retrieval error before container start | Execution-role secret permission, secret ARN, Secrets Manager endpoint, or KMS permission |
| DNS or timeout connecting to RDS | Wrong subnets, security groups, endpoint hostname, or VPC DNS settings |
| Certificate verification failure | Missing/stale CA bundle or connection to a hostname other than the RDS endpoint |
| `psql` exits nonzero | SQL error, missing variable, insufficient database privileges, or failed assertion |

### 12.2 Confirm Database Logs

Use the RDS console or CLI to confirm that the expected connection occurred and
that PostgreSQL did not record authentication, permission, or TLS errors:

```bash
# List database log files without retrieving secret values.
aws rds describe-db-log-files \
  --db-instance-identifier telecom-analytics-dev \
  --output table
```

### 12.3 Record the Initialization

Complete the worksheet below. Preserve the ECS task ARN and image digest as the
audit trail for the exact initializer execution.

## 13. Initialization Worksheet

| Item | Recorded value |
| --- | --- |
| AWS account alias or label | `<account-label>` |
| Region | `<region>` |
| Application subnet IDs | `<application-subnet-id-1>` <br/> `<application-subnet-id-2>` |
| Application security group ID | `<application-security-group-id>` |
| Endpoint security group ID | `<endpoint-security-group-id>` |
| ECR API endpoint ID | `<ecr-api-endpoint-id>` |
| ECR DKR endpoint ID | `<ecr-dkr-endpoint-id>` |
| Secrets Manager endpoint ID | `<secrets-manager-endpoint-id>` |
| CloudWatch Logs endpoint ID | `<cloudwatch-logs-endpoint-id>` |
| S3 gateway endpoint ID | `<s3-gateway-endpoint-id>` |
| ECR repository URI | `<account-id>.dkr.ecr.<region>.amazonaws.com/telecom-analytics/db-init` |
| Initializer image tag | `<image-tag>` |
| Initializer image digest | `<image-digest>` |
| Exporter secret ARN | `<exporter-secret-arn>` |
| ECS cluster ARN | `<ecs-cluster-arn>` |
| Task definition ARN and revision | `<task-definition-arn-and-revision>` |
| Initialization task ARN | `<initialization-task-arn>` |
| Task exit code | `<task-exit-code>` |
| CloudWatch log stream | `<cloudwatch-log-stream>` |
| Initialization timestamp | `<initialization-timestamp>` |
| Deviations from this runbook | |

## 14. Rerun and Change Control

- Do not edit an existing ECR image tag. Build a new immutable image for every
  schema change.
- Register a new task-definition revision pinned to the new image digest.
- Review SQL for forward and rerun safety before execution.
- Run exactly one task and retain its task ARN, image digest, exit code, and
  log stream.
- Treat destructive schema changes as a separate procedure requiring a tested
  backup and rollback plan.
- Rerunning `02-monitoring-user.sql` intentionally updates the exporter role to
  the current exporter secret password.

## 15. Cost Control and Teardown

The stopped Fargate task no longer incurs task-compute charges. The following
resources can continue to incur charges:

- Four interface VPC endpoints in each selected Availability Zone.
- The exporter Secrets Manager secret.
- ECR image storage and scanning.
- CloudWatch Logs storage.

Keep the endpoints if the next stage will deploy private ECS services. If the
lab will pause, delete resources in this order:

1. Deregister obsolete task-definition revisions.
2. Delete unneeded ECR images and then the repository.
3. Delete the exporter secret only after no exporter deployment uses it.
4. Delete the four interface endpoints and the S3 gateway endpoint.
5. Delete `telecom-analytics-dev-endpoints-sg`.
6. Delete the initialization log group if its audit history is no longer
   required.
7. Delete the empty ECS cluster if no later service uses it.

Do not delete the application or RDS security groups, application subnets,
database subnets, or RDS-managed master secret while RDS and dependent services
remain in use.

## 16. AWS References

- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Pass Secrets Manager secrets through Amazon ECS environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)
- [AWS PrivateLink access for Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/vpc-endpoint-overview.html)
- [CloudWatch Logs interface VPC endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch-logs-and-interface-VPC.html)
- [VPC gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)
- [Using SSL with RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- [Running standalone Amazon ECS tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html)
