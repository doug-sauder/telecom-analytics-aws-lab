# CloudWatch log groups preserve the inspected seven-day retention.
resource "aws_cloudwatch_log_group" "db_init" {
  name              = "/ecs/${local.name_prefix}/db-init"
  retention_in_days = 7
  log_group_class   = "STANDARD"
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/ecs/${local.name_prefix}/ingest"
  retention_in_days = 7
  log_group_class   = "STANDARD"
}

resource "aws_cloudwatch_log_group" "pmgen" {
  name              = "/ecs/${local.name_prefix}/pmgen"
  retention_in_days = 7
  log_group_class   = "STANDARD"
}
