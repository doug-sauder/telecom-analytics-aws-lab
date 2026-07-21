# Outputs expose the main IDs, ARNs, endpoints, and image destinations needed after apply.
output "vpc_id" {
  description = "Created VPC ID."
  value       = aws_vpc.main.id
}

output "app_subnet_ids" {
  description = "Private application subnet IDs."
  value       = [for subnet in aws_subnet.app : subnet.id]
}

output "db_subnet_ids" {
  description = "Private database subnet IDs."
  value       = [for subnet in aws_subnet.db : subnet.id]
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint address."
  value       = aws_db_instance.main.address
}

output "rds_master_secret_arn" {
  description = "RDS-managed master credential secret ARN."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
  sensitive   = true
}

output "postgres_exporter_secret_arn" {
  description = "Postgres exporter secret ARN."
  value       = aws_secretsmanager_secret.postgres_exporter.arn
}

output "pm_events_queue_url" {
  description = "PM events SQS queue URL."
  value       = aws_sqs_queue.pm_events.url
}

output "ecr_repository_urls" {
  description = "ECR repository URLs for images built outside Terraform."
  value = {
    db_init = aws_ecr_repository.db_init.repository_url
    ingest  = aws_ecr_repository.ingest.repository_url
    pmgen   = aws_ecr_repository.pmgen.repository_url
  }
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.main.arn
}
