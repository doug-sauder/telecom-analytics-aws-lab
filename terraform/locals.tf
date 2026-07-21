# Shared names, tags, and service maps used by the lab resources.
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_tag
    Environment = var.environment
    ManagedBy   = "terraform"
    Owner       = var.owner
  }

  public_subnets = {
    a = {
      name = "${local.name_prefix}-public-a"
      cidr = var.subnet_cidrs.public_a
      az   = var.availability_zones[0]
    }
    b = {
      name = "${local.name_prefix}-public-b"
      cidr = var.subnet_cidrs.public_b
      az   = var.availability_zones[1]
    }
  }

  app_subnets = {
    a = {
      name = "${local.name_prefix}-app-a"
      cidr = var.subnet_cidrs.app_a
      az   = var.availability_zones[0]
    }
    b = {
      name = "${local.name_prefix}-app-b"
      cidr = var.subnet_cidrs.app_b
      az   = var.availability_zones[1]
    }
  }

  db_subnets = {
    a = {
      name = "${local.name_prefix}-db-a"
      cidr = var.subnet_cidrs.db_a
      az   = var.availability_zones[0]
    }
    b = {
      name = "${local.name_prefix}-db-b"
      cidr = var.subnet_cidrs.db_b
      az   = var.availability_zones[1]
    }
  }

  interface_endpoint_services = {
    ecr_api = {
      name    = "${local.name_prefix}-ecr-api-vpce"
      service = "ecr.api"
    }
    ecr_dkr = {
      name    = "${local.name_prefix}-ecr-dkr-vpce"
      service = "ecr.dkr"
    }
    secretsmanager = {
      name    = "${local.name_prefix}-secrets-vpce"
      service = "secretsmanager"
    }
    logs = {
      name    = "${local.name_prefix}-logs-vpce"
      service = "logs"
    }
    sqs = {
      name    = "${local.name_prefix}-sqs-vpce"
      service = "sqs"
    }
  }
}
