# Database subnet group and private PostgreSQL instance reconstructed from live RDS settings.
resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db-subnets"
  description = "Private database subnets for telecom analytics development"
  subnet_ids  = [for subnet in aws_subnet.db : subnet.id]

  tags = {
    Name = "${local.name_prefix}-db-subnets"
  }
}

resource "aws_db_instance" "main" {
  identifier = local.name_prefix

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_master_username

  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false
  port                   = 5432

  backup_retention_period = 7
  copy_tags_to_snapshot   = true
  deletion_protection     = false
  skip_final_snapshot     = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
  monitoring_interval          = 0

  ca_cert_identifier = "rds-ca-rsa2048-g1"

  tags = {
    Name = local.name_prefix
  }
}
