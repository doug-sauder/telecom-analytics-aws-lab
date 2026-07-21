# Terraform Runbook

## Purpose

This runbook explains the day-to-day Terraform procedures for the AWS version of
the telecom analytics lab. It assumes the Terraform files in `terraform/` are the
source of truth for the lab infrastructure.

For a summary of the infrastructure modeled by Terraform, see
`terraform/README.md`.

## Prerequisites

- GitHub repository cloned locally.
- Terraform CLI `>= 1.6.0`.
- AWS CLI installed and configured.
- AWS credentials with permission to manage the lab resources in `us-east-1`.
- Docker installed if you need to build and push the application images.
- Access to the target AWS account and region before running `plan` or `apply`.

Run Terraform commands from the `terraform/` directory unless noted otherwise.

```bash
cd terraform
```

## First-Time Setup

Initialize Terraform providers:

```bash
terraform init
```

Create a local variable file from the example if overrides are needed:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` for the target environment. Keep secrets and local-only
values out of Git.

Format and validate the configuration:

```bash
terraform fmt
terraform validate
```

## Review a Change

Always run a plan before applying changes:

```bash
terraform plan
```

For reviewable output, save the plan:

```bash
terraform plan -out=tfplan
terraform show tfplan
```

Expected result: Terraform shows only the infrastructure changes you intend to
make. Stop and investigate if the plan wants to replace shared network,
database, or ECS resources unexpectedly.

Remove the local plan file after use:

```bash
rm tfplan
```

## Apply a Change

Apply directly after reviewing the plan:

```bash
terraform apply
```

Or apply a saved plan:

```bash
terraform apply tfplan
```

After apply completes, capture the useful outputs:

```bash
terraform output
terraform output ecr_repository_urls
terraform output pm_events_queue_url
terraform output rds_endpoint
```

Sensitive outputs require explicit access:

```bash
terraform output rds_master_secret_arn
```

## Clean-Slate Build Order

Terraform creates ECR repositories, but it does not build or push Docker images.
For a brand-new account or region, create the infrastructure in two passes.

First, create the base resources without long-running ECS services:

```bash
terraform apply -var='create_ecs_services=false'
```

Then build and push the `db-init`, `ingest`, and `pmgen` images to the ECR
repository URLs from:

```bash
terraform output ecr_repository_urls
```

After the images are available, update the image digest variables in
`terraform.tfvars`:

```hcl
db_init_image_digest = "sha256:<digest>"
ingest_image_digest  = "sha256:<digest>"
pmgen_image_digest   = "sha256:<digest>"
```

Then enable ECS services:

```bash
terraform apply -var='create_ecs_services=true'
```

## Cost-Control Mode

For a dormant rebuild, disable billable interface endpoints and long-running ECS
services:

```hcl
create_interface_endpoints = false
create_ecs_services        = false
ingest_desired_count       = 0
pmgen_desired_count        = 0
```

Apply the change:

```bash
terraform apply
```

To restore the running application, set `create_ecs_services` to `true`, restore
the desired counts, and apply again.

## Verify AWS Resources

Use Terraform outputs first:

```bash
terraform output vpc_id
terraform output app_subnet_ids
terraform output db_subnet_ids
terraform output ecs_cluster_arn
```

Then confirm key resources in AWS:

```bash
aws ecs list-services --cluster telecom-analytics-dev
aws rds describe-db-instances --db-instance-identifier telecom-analytics-dev
aws sqs get-queue-url --queue-name telecom-analytics-dev-pm-events
aws ecr describe-repositories
```

Expected result: the AWS resources match the Terraform plan and outputs for the
target environment.

## Troubleshooting

**Terraform cannot find AWS credentials**

Confirm the active AWS identity:

```bash
aws sts get-caller-identity
```

If this returns the wrong account, switch profiles or refresh credentials before
running Terraform again.

**ECS services fail after a clean-slate apply**

Confirm that image digests exist in ECR and that `terraform.tfvars` points to the
current digests:

```bash
aws ecr describe-images --repository-name telecom-analytics/ingest
aws ecr describe-images --repository-name telecom-analytics/pmgen
aws ecr describe-images --repository-name telecom-analytics/db-init
```

If the images are missing, push them first and re-run `terraform apply`.

**Plan shows resource replacement**

Do not apply until the replacement is understood. Check whether the change is
from an intentional variable update, a provider default change, or drift in the
AWS account.

**State does not match AWS**

Run a refresh-only plan:

```bash
terraform plan -refresh-only
```

If drift is expected and safe to record, apply the refresh-only change:

```bash
terraform apply -refresh-only
```

## Destroy the Lab

Destroying the Terraform-managed lab deletes infrastructure and can delete data.
Only run this when teardown is intentional.

Preview the destroy operation:

```bash
terraform plan -destroy
```

Destroy the resources:

```bash
terraform destroy
```

After destroy completes, verify that billable resources are gone in AWS,
especially ECS services, RDS, VPC endpoints, NAT gateways if any were added
later, and ECR repositories.

## Pre-Commit Checklist

- `terraform fmt` has been run.
- `terraform validate` passes.
- A fresh `terraform plan` has been reviewed.
- Local state, private variables, and plan files are not staged.
- Documentation reflects any changed operational procedure.
