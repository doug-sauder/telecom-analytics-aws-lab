# AWS ECS Application Runtime

## 1. Purpose

This runbook explains how to deploy the first long-running application services
for the Telecom Analytics AWS Lab after the private RDS database has been
initialized.

The phase moves the lab from a one-off database initialization task to private
Amazon ECS services on AWS Fargate. The target runtime keeps Amazon RDS as the
database of record, uses Amazon SQS as the managed event buffer, and sends
application logs to Amazon CloudWatch Logs.

The intended application path for this phase is:

```text
pmgen -> SQS -> ingest -> RDS PostgreSQL
```

This runbook intentionally does not expose RDS publicly, does not add a NAT
gateway, and does not require workstation access to the database.

## 2. Design Decisions

- Keep application tasks private in the existing application subnets.
- Reuse `telecom-analytics-dev-app-sg` as the only source permitted to reach
  RDS PostgreSQL.
- Use Fargate services for long-running `pmgen` and `ingest` containers.
- Use SQS instead of running Redpanda/Kafka in this AWS lab phase.
- Store all database credentials in Secrets Manager and inject them through ECS
  task definitions.
- Send container stdout and stderr to CloudWatch Logs.
- Use VPC endpoints for private access to ECR, Secrets Manager, CloudWatch Logs,
  S3, and SQS.
- Keep task execution roles separate from application task roles.
- Build immutable application images and pin deployed task definitions to image
  digests.

The current local codebase still includes Kafka-oriented defaults. This phase
therefore includes an implementation change before deployment: add SQS producer
and consumer support, then deploy the SQS mode to ECS.

**Important**: The `ingest` image does not import the trusted CA certificate chain
needed to verify the PostgreSQL server certificate. Consequently, it opens the required
TLS connection without authenticating the PostgreSQL server. In a real-world deployment,
this omission would be a security flaw. Here, we made a quick fix, considered acceptable
for a learning environment project. This is a flaw that could be fixed in the future (if
the project continues).

## 3. Preconditions

Before creating resources:

1. Complete and verify `docs/aws-rds-console-setup.md`.
2. Complete and verify `docs/aws-rds-schema-initialization.md`.
3. Confirm that the initialization task exit code was `0`.
4. Confirm that the RDS security group permits TCP `5432` only from
   `telecom-analytics-dev-app-sg`.
5. Confirm that the ECS cluster `telecom-analytics-dev` still exists.
6. Confirm that the private application subnets can reach ECR, Secrets Manager,
   CloudWatch Logs, and S3 through the endpoints created during database
   initialization.
7. Use an IAM identity that can administer SQS, ECR, ECS, IAM, Secrets Manager,
   CloudWatch Logs, and EC2 VPC endpoints.
8. Use a networked workstation or standard CloudShell environment with Git,
   Docker, and AWS CLI access to build and push application images.
9. Keep shell command tracing disabled whenever secret-backed environment
   variables are present. Do not use `set -x`.

Suggested tags are the same as the earlier AWS stages:

| Key | Value |
| --- | --- |
| `Project` | `telecom-analytics-aws-lab` |
| `Environment` | `dev` |
| `ManagedBy` | `console` |
| `Owner` | AWS account owner or team name |

## 4. Implementation Scope

### 4.1 Required Code Changes

Add an AWS transport mode before building the application images:

- `pmgen` must publish generated PM events to SQS.
- `ingest` must poll SQS, validate messages, write accepted events to
  `analytics.pm_events`, and delete messages only after successful persistence.
- `ingest` must keep its HTTP health, readiness, and metrics endpoints.
- Both services must emit useful structured-enough logs without printing
  secrets.
- Runtime mode must be selected through environment variables, not image tags.

Use the current local defaults for Docker Compose and Kubernetes until those
workflows are intentionally updated. The AWS-specific mode should be additive.

### 4.2 Required Runtime Configuration

For `ingest`, preserve the existing database variables:

| Name | Source |
| --- | --- |
| `PGHOST` | Non-secret environment variable, \<AWS host> |
| `PGPORT` | Non-secret environment variable, `5432` |
| `PGUSER` | RDS-managed secret JSON key `username` |
| `PGPASSWORD` | RDS-managed secret JSON key `password` |
| `PGDATABASE` | Non-secret environment variable, `telecom` |

Add AWS event-source configuration:

| Name | Value |
| --- | --- |
| `EVENT_TRANSPORT` | `sqs` |
| `SQS_QUEUE_URL` | Queue URL for `telecom-analytics-dev-pm-events` |
| `AWS_REGION` | `us-east-1` |
| `PORT` | `3000` |

For `pmgen`, add AWS event-target configuration:

| Name | Value |
| --- | --- |
| `PMGEN_EVENT_TRANSPORT` | `sqs` |
| `PMGEN_SQS_QUEUE_URL` | Queue URL for `telecom-analytics-dev-pm-events` |
| `PMGEN_INTERVAL_SECONDS` | Start with `5` |
| `PMGEN_CELL_COUNT` | Start with `50` |
| `PMGEN_SOURCE` | `pmgen-ecs` |
| `PMGEN_PROMETHEUS_PORT` | `8000` |
| `AWS_REGION` | `us-east-1` |

The exact variable names can change during implementation, but the task
definitions must stay explicit and documented.

## 5. Create Private AWS Service Access for SQS

The database initialization phase already created private endpoints for ECR,
Secrets Manager, CloudWatch Logs, and S3. Add an interface endpoint for SQS so
private ECS tasks can call SQS without a NAT gateway.

### 5.1 Create the SQS Interface Endpoint

1. Open **VPC > Endpoints > Create endpoint**.
2. Select **AWS services**.
3. Choose `com.amazonaws.us-east-1.sqs`.
4. Name it `telecom-analytics-dev-sqs-vpce`.
5. Select the lab VPC.
6. Select both application subnets.
7. Attach only `telecom-analytics-dev-endpoints-sg`.
8. Enable private DNS.
9. Apply the standard project tags.

### 5.2 Verify Endpoint Access

Confirm that:

- The application route table still has no `0.0.0.0/0` route.
- The S3 gateway endpoint route from the previous phase remains in place.
- The new SQS interface endpoint reports **Available**.
- Private DNS is enabled on the SQS endpoint.
- The endpoint security group allows HTTPS from `telecom-analytics-dev-app-sg`.

## 6. Create the SQS Queue

### 6.1 Create the Dead-Letter Queue

1. Open **SQS > Queues > Create queue**.
2. Choose **Standard**.
3. Name it `telecom-analytics-dev-pm-events-dlq`.
4. Keep encryption enabled with SQS-managed encryption unless the project later
   adopts a customer-managed KMS key.
5. Apply the standard project tags.

### 6.2 Create the Main Queue

1. Open **SQS > Queues > Create queue**.
2. Choose **Standard**.
3. Name it `telecom-analytics-dev-pm-events`.
4. Set the visibility timeout to `60` seconds for the first pass.
5. Set message retention to at least `1` day.
6. Enable the dead-letter queue from section 6.1.
7. Set `maxReceiveCount` to `5`.
8. Keep encryption enabled with SQS-managed encryption unless the project later
   adopts a customer-managed KMS key.
9. Apply the standard project tags.

The first pass uses a Standard queue because strict ordering is not required for
the current KPI views. Event idempotency remains the responsibility of the
database `event_id` constraint.

## 7. Create ECR Repositories and Push Images

### 7.1 Create Repositories

Create two private ECR repositories:

| Repository name | Purpose |
| --- | --- |
| `telecom-analytics/ingest` | Ingest service image |
| `telecom-analytics/pmgen` | PM generator image |

For each repository:

1. Enable immutable image tags.
2. Enable scan on push if available in the selected scanning configuration.
3. Enable AES-256 server-side encryption or use the project KMS policy.
4. Apply the standard project tags.

### 7.2 Build and Push

Run from the repository root in a standard, networked shell. Replace
`<account-id>` and `<release-tag>` with recorded values:

```bash
# Authenticate Docker to the private ECR registry.
aws ecr get-login-password --region us-east-1 \
  | docker login \
      --username AWS \
      --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build application images for the architecture used by the task definitions.
docker build \
  --platform linux/amd64 \
  --tag telecom-analytics-ingest:<release-tag> \
  services/ingest

docker build \
  --platform linux/amd64 \
  --tag telecom-analytics-pmgen:<release-tag> \
  services/pmgen

# Tag immutable images for ECR.
docker tag \
  telecom-analytics-ingest:<release-tag> \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/ingest:<release-tag>

docker tag \
  telecom-analytics-pmgen:<release-tag> \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/pmgen:<release-tag>

# Push images.
docker push \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/ingest:<release-tag>

docker push \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/telecom-analytics/pmgen:<release-tag>
```

Record both image digests. ECS task definitions should pin images by digest, not
rely on mutable tags.

## 8. Create IAM Roles

### 8.1 Shared Task Execution Role

Create `telecom-analytics-dev-app-execution-role` with:

- Trusted service: `ecs-tasks.amazonaws.com`.
- Managed policy: `AmazonECSTaskExecutionRolePolicy`.
- An inline policy permitting `secretsmanager:GetSecretValue` on only the
  RDS-managed master secret ARN.
- `kms:Decrypt` only if the secret uses a customer-managed KMS key.

ECS uses the execution role to pull images, create log streams, and inject
task-definition secrets. Application code must not use this role for SQS or
other AWS API calls.

### 8.2 Ingest Task Role

Create `telecom-analytics-dev-ingest-task-role` trusted by
`ecs-tasks.amazonaws.com` with least-privilege SQS access to only
`telecom-analytics-dev-pm-events`:

- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility`
- `sqs:GetQueueAttributes`
- `sqs:GetQueueUrl`

If the queue uses a customer-managed KMS key, add the minimum required KMS
permissions for that key.

### 8.3 PM Generator Task Role

Create `telecom-analytics-dev-pmgen-task-role` trusted by
`ecs-tasks.amazonaws.com` with least-privilege SQS access to only
`telecom-analytics-dev-pm-events`:

- `sqs:SendMessage`
- `sqs:GetQueueAttributes`
- `sqs:GetQueueUrl`

Do not grant database access to the `pmgen` task role. `pmgen` should only
produce events.

## 9. Create CloudWatch Logging

Create these log groups:

| Log group | Retention |
| --- | --- |
| `/ecs/telecom-analytics-dev/ingest` | 7 or 14 days |
| `/ecs/telecom-analytics-dev/pmgen` | 7 or 14 days |

Use default encryption or the project KMS policy, and apply the standard tags.

The application containers must never print environment variables, secret JSON,
database passwords, or connection URIs.

## 10. Register ECS Task Definitions

### 10.1 Ingest Task Definition

Register `telecom-analytics-dev-ingest` with:

| Setting | Value |
| --- | --- |
| Launch type | AWS Fargate |
| Operating system | Linux |
| CPU architecture | `X86_64` |
| Task CPU | `0.25 vCPU` |
| Task memory | `0.5 GB` |
| Network mode | `awsvpc` |
| Execution role | `telecom-analytics-dev-app-execution-role` |
| Task role | `telecom-analytics-dev-ingest-task-role` |
| Container name | `ingest` |
| Image | ECR image URI pinned by digest |
| Essential | Yes |
| Container port | `3000` |
| Log driver | `awslogs` |
| Log group | `/ecs/telecom-analytics-dev/ingest` |
| Log stream prefix | `ingest` |

Add non-secret environment variables:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `PGDATABASE` | `telecom` |
| `EVENT_TRANSPORT` | `sqs` |
| `SQS_QUEUE_URL` | \<redacted> |
| `AWS_REGION` | `us-east-1` |
| `PGHOST` | \<rds-endpoint> |
| `PGPORT` | `5432` |
| `PGSSLMODE` | `required` |

Map these container secrets from the RDS-managed secret JSON:

| Environment variable | JSON key |
| --- | --- |
| `PGUSER` | `username` |
| `PGPASSWORD` | `password` |

Configure container health check after the image includes a suitable HTTP
client:

```text
CMD-SHELL,node -e "const http = require('http'); const request = http.get('http://127.0.0.1:3000/readyz', function(response) { process.exit(response.statusCode === 200 ? 0 : 1); }); request.on('error', function() { process.exit(1); }); request.setTimeout(5000, function() { request.destroy(); process.exit(1); });" || exit 1
```

Note: The `node` command is equivalent to:

```text
CMD-SHELL,curl -fsS http://localhost:3000/readyz || exit 1
```

### 10.2 PM Generator Task Definition

Register `telecom-analytics-dev-pmgen` with:

| Setting | Value |
| --- | --- |
| Launch type | AWS Fargate |
| Operating system | Linux |
| CPU architecture | `X86_64` |
| Task CPU | `0.25 vCPU` |
| Task memory | `0.5 GB` |
| Network mode | `awsvpc` |
| Execution role | `telecom-analytics-dev-app-execution-role` |
| Task role | `telecom-analytics-dev-pmgen-task-role` |
| Container name | `pmgen` |
| Image | ECR image URI pinned by digest |
| Essential | Yes |
| Container port | `8000` |
| Log driver | `awslogs` |
| Log group | `/ecs/telecom-analytics-dev/pmgen` |
| Log stream prefix | `pmgen` |

Add non-secret environment variables:

| Name | Value |
| --- | --- |
| `PMGEN_EVENT_TRANSPORT` | `sqs` |
| `PMGEN_SQS_QUEUE_URL` | \<redacted> |
| `PMGEN_INTERVAL_SECONDS` | `5` |
| `PMGEN_CELL_COUNT` | `50` |
| `PMGEN_SOURCE` | `pmgen-ecs` |
| `PMGEN_PROMETHEUS_PORT` | `8000` |
| `AWS_REGION` | `us-east-1` |

Do not inject database secrets into `pmgen`.

## 11. Create ECS Services

### 11.1 Create the Ingest Service

1. Open the `telecom-analytics-dev` ECS cluster.
2. Choose **Create service**.
3. Select launch type **Fargate**.
4. Select task definition `telecom-analytics-dev-ingest`.
5. Name the service `ingest`.
6. Set desired tasks to `1`.
7. Select the lab VPC.
8. Select both application subnets.
9. Attach only `telecom-analytics-dev-app-sg`.
10. Set **Public IP** to **Turned off**.
11. Do not attach a load balancer for the first private validation pass.
12. Enable ECS managed tags and create the service.

Wait for the service to reach a steady state before creating `pmgen`.

### 11.2 Create the PM Generator Service

1. Open the `telecom-analytics-dev` ECS cluster.
2. Choose **Create service**.
3. Select launch type **Fargate**.
4. Select task definition `telecom-analytics-dev-pmgen`.
5. Name the service `pmgen`.
6. Set desired tasks to `1`.
7. Select the lab VPC.
8. Select both application subnets.
9. Attach only `telecom-analytics-dev-app-sg`.
10. Set **Public IP** to **Turned off**.
11. Do not attach a load balancer for the first private validation pass.
12. Enable ECS managed tags and create the service.

Only start `pmgen` after `ingest` is healthy enough to drain the queue.

## 12. Validate the Result

### 12.1 Inspect ECS and CloudWatch

Confirm that:

- Both ECS services reach a steady state.
- Each service has one running task.
- No task is repeatedly stopping or restarting.
- CloudWatch logs show successful startup.
- Logs do not contain passwords, secret JSON, or connection URIs.
- `pmgen` logs show messages being sent.
- `ingest` logs show messages being received and persisted.

### 12.2 Confirm SQS Queue Behavior

Open the main SQS queue and confirm that:

- Messages sent increases after `pmgen` starts.
- Messages received and deleted increase after `ingest` starts.
- Approximate visible messages returns near zero during steady state.
- No messages accumulate in the dead-letter queue during the initial validation.

Temporary visible messages are acceptable while `pmgen` is producing and
`ingest` is polling. A steadily growing backlog indicates that `ingest` is not
keeping up or is failing to delete messages.

### 12.3 Confirm Database Writes

Use another one-off private ECS task, based on the existing DB initializer image
or a dedicated validation image, to run a read-only query against RDS. Do not
make the database public for validation.

The validation query should confirm recent ECS-generated events:

```sql
SELECT
    source,
    count(*) AS event_count,
    max(event_time) AS latest_event_time
FROM analytics.pm_events
WHERE source = 'pmgen-ecs'
GROUP BY source;
```

Expected result:

- One row for `pmgen-ecs`.
- `event_count` greater than zero.
- `latest_event_time` close to the current validation time.

### 12.4 Optional Private HTTP Check

If a temporary validation task is available in the application subnets, call the
ingest task directly through ECS service discovery or task private IP:

```bash
curl -fsS http://<ingest-private-ip>:3000/healthz
curl -fsS http://<ingest-private-ip>:3000/readyz
curl -fsS http://<ingest-private-ip>:3000/metrics
```

Do not add a public load balancer for this first validation pass unless the next
phase explicitly requires external access.

## 13. Application Runtime Worksheet

Complete the worksheet below. Preserve task-definition revisions, image digests,
queue URLs, and validation timestamps as the audit trail for this phase.

| Item | Recorded value |
| --- | --- |
| AWS account alias or label | |
| Region | `us-east-1` |
| ECS cluster ARN | |
| Application subnet IDs | |
| Application security group ID | |
| SQS endpoint ID | |
| PM events queue URL | |
| PM events queue ARN | |
| PM events DLQ URL | |
| PM events DLQ ARN | |
| Ingest ECR repository URI | |
| Ingest image tag | |
| Ingest image digest | |
| PM generator ECR repository URI | |
| PM generator image tag | |
| PM generator image digest | |
| App execution role ARN | |
| Ingest task role ARN | |
| PM generator task role ARN | |
| Ingest task definition ARN and revision | |
| PM generator task definition ARN and revision | |
| Ingest service ARN | |
| PM generator service ARN | |
| Ingest log group | `/ecs/telecom-analytics-dev/ingest` |
| PM generator log group | `/ecs/telecom-analytics-dev/pmgen` |
| Validation task ARN | |
| Validation timestamp | |
| Deviations from this runbook | |

## 14. Change Control

- Build a new immutable image for every application change.
- Register a new task-definition revision pinned to the new image digest.
- Deploy `ingest` before `pmgen` when changing event contracts.
- Keep SQS message deletion after database commit.
- Treat changes to queue type, visibility timeout, DLQ policy, or message
  schema as compatibility changes requiring validation.
- Keep database schema changes in the database initialization workflow, not in
  application container startup.

## 15. Cost Control and Teardown

The following resources can continue to incur charges:

- Two Fargate services while desired count is greater than zero.
- ECR image storage and scanning.
- CloudWatch Logs storage.
- The SQS interface VPC endpoint in each selected Availability Zone.
- SQS requests and retained messages.
- RDS and Secrets Manager resources from previous phases.

To pause the application runtime while preserving the database:

1. Set desired count for `pmgen` to `0`.
2. Wait until no messages remain visible or in flight in the main queue.
3. Set desired count for `ingest` to `0`.
4. Keep the SQS queue if later validation should resume with the same queue.

To fully tear down this phase:

1. Set desired count for both ECS services to `0`.
2. Delete the `pmgen` ECS service.
3. Delete the `ingest` ECS service.
4. Delete obsolete task-definition revisions when they are no longer needed for
   audit or rollback.
5. Delete unneeded ECR images and repositories.
6. Delete the SQS main queue and dead-letter queue.
7. Delete the SQS interface endpoint if no private task needs SQS access.
8. Delete the application log groups if their audit history is no longer
   required.
9. Delete app-specific IAM roles after no task definition uses them.

Do not delete the application security group, RDS security group, application
subnets, database subnets, RDS instance, RDS-managed secret, or database
initialization artifacts while dependent phases remain in use.

## 16. AWS References

- [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Pass Secrets Manager secrets through Amazon ECS environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Amazon SQS standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)
- [Amazon SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS interface VPC endpoints](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-internetwork-traffic-privacy.html)
- [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)
- [CloudWatch Logs interface VPC endpoints](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch-logs-and-interface-VPC.html)
