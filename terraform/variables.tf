# Core project inputs inferred from the live AWS environment.
variable "aws_region" {
  description = "AWS region where the lab is deployed."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used in AWS resource names."
  type        = string
  default     = "telecom-analytics"
}

variable "project_tag" {
  description = "Project tag value used to identify lab resources."
  type        = string
  default     = "telecom-analytics-aws-lab"
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "dev"
}

variable "owner" {
  description = "Owner tag value applied to created resources."
  type        = string
  default     = "Doug Sauder"
}

# Network inputs preserve the inspected VPC shape.
variable "vpc_cidr" {
  description = "IPv4 CIDR block for the lab VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones used by the inspected two-AZ lab layout."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "subnet_cidrs" {
  description = "CIDR blocks for each subnet tier and AZ."
  type = object({
    public_a = string
    public_b = string
    app_a    = string
    app_b    = string
    db_a     = string
    db_b     = string
  })

  default = {
    public_a = "10.20.0.0/24"
    public_b = "10.20.1.0/24"
    app_a    = "10.20.10.0/24"
    app_b    = "10.20.11.0/24"
    db_a     = "10.20.20.0/24"
    db_b     = "10.20.21.0/24"
  }
}

# Cost-control inputs allow expensive hourly resources to be recreated only when needed.
variable "create_interface_endpoints" {
  description = "Create billable interface VPC endpoints for private ECS access to AWS APIs."
  type        = bool
  default     = true
}

variable "create_ecs_services" {
  description = "Create long-running ECS services. Set false until images are pushed in a clean account."
  type        = bool
  default     = true
}

variable "ingest_desired_count" {
  description = "Desired ECS task count for the ingest service."
  type        = number
  default     = 1
}

variable "pmgen_desired_count" {
  description = "Desired ECS task count for the pmgen service."
  type        = number
  default     = 1
}

# Database inputs preserve the inspected RDS configuration.
variable "db_engine_version" {
  description = "RDS PostgreSQL engine version."
  type        = string
  default     = "18.3"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "telecom"
}

variable "db_master_username" {
  description = "RDS master username. Password is managed by RDS in Secrets Manager."
  type        = string
  default     = "telecom_admin"
}

# Image inputs capture the currently deployed image digests.
variable "db_init_image_digest" {
  description = "Pinned digest for the db-init ECR image."
  type        = string
  default     = "sha256:cdee03b0aa2acb14d758eb24c7e79aa4de422b1b722dce9c3019d408d100f90d"
}

variable "ingest_image_digest" {
  description = "Pinned digest for the ingest ECR image."
  type        = string
  default     = "sha256:334ab8aa8c5ecf5501c00a2e1db6397350d1ceb18e3f3ee212d04a9b8e7754a8"
}

variable "pmgen_image_digest" {
  description = "Pinned digest for the pmgen ECR image."
  type        = string
  default     = "sha256:b7956b4e64122d784725fa1a6a5be570cb8f57d5ad0a210e8568d6514a3d9e48"
}
