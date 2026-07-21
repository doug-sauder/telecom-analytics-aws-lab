# Terraform Reconstruction

This Terraform was generated from the repository runbooks and a read-only
inspection of the live AWS resources in account `<redacted>`, region
`us-east-1`.

## What It Recreates

- Dedicated VPC with public, application, and database subnets in `us-east-1a`
  and `us-east-1b`.
- Public route table with an internet gateway route.
- Private application and database route tables with no NAT gateway.
- S3 gateway endpoint on the application route table.
- Optional interface endpoints for ECR API, ECR Docker, Secrets Manager,
  CloudWatch Logs, and SQS.
- Application, RDS, and endpoint security groups.
- RDS PostgreSQL `18.3` on `db.t4g.micro`, private, gp3, encrypted, with
  RDS-managed master credentials.
- Postgres exporter secret with a generated password.
- ECR repositories for `db-init`, `ingest`, and `pmgen`.
- SQS main queue and DLQ.
- IAM roles and inline policies for ECS execution, SQS access, and secret
  injection.
- CloudWatch log groups.
- ECS cluster, task definitions, and optional ECS services.

## Clean-Slate Ordering

Terraform creates ECR repositories, but it does not build or push Docker images.
For a brand-new account or region, use this sequence:

```bash
terraform init
terraform apply -var='create_ecs_services=false'
```

Then build and push the three images to the output repository URLs. After the
image digests are available, update `terraform.tfvars` and run:

```bash
terraform apply -var='create_ecs_services=true'
```

## Cost Controls

The interface endpoints are the largest avoidable idle networking cost. For a
dormant rebuild, set:

```hcl
create_interface_endpoints = false
create_ecs_services        = false
ingest_desired_count       = 0
pmgen_desired_count        = 0
```

The S3 gateway endpoint has no additional endpoint hourly charge and is left on
by default.
