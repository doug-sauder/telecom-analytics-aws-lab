# Shared ECS task trust policy.
data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution roles allow ECS to pull images, write logs, and inject required secrets.
resource "aws_iam_role" "db_init_execution" {
  name               = "${local.name_prefix}-db-init-execution-role"
  description        = "Allows ECS to pull the db-init image, write logs, and inject secrets."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "app_execution" {
  name               = "${local.name_prefix}-app-execution-role"
  description        = "Allows ECS to pull app images, write logs, and inject secrets."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "db_init_execution_managed" {
  role       = aws_iam_role.db_init_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "app_execution_managed" {
  role       = aws_iam_role.app_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "db_init_execution_secrets" {
  name = "${local.name_prefix}-db-init-secrets"
  role = aws_iam_role.db_init_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadDatabaseInitializationSecrets"
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          aws_db_instance.main.master_user_secret[0].secret_arn,
          aws_secretsmanager_secret.postgres_exporter.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "app_execution_master_secret" {
  name = "master-secret-policy"
  role = aws_iam_role.app_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowRdsMasterSecretRead"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_db_instance.main.master_user_secret[0].secret_arn
      }
    ]
  })
}

# Task roles limit application containers to only the APIs they call directly.
resource "aws_iam_role" "db_init_task" {
  name               = "${local.name_prefix}-db-init-task-role"
  description        = "Runtime role for one-off database initialization tasks."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "ingest_task" {
  name               = "${local.name_prefix}-ingest-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role" "pmgen_task" {
  name               = "${local.name_prefix}-pmgen-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "ingest_sqs" {
  name = "${local.name_prefix}-ingest-sqs-access"
  role = aws_iam_role.ingest_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowIngestFromPmEventsQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = aws_sqs_queue.pm_events.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "pmgen_sqs" {
  name = "${local.name_prefix}-pmgen-sqs-access"
  role = aws_iam_role.pmgen_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPmgenToSendToPmEventsQueue"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = aws_sqs_queue.pm_events.arn
      }
    ]
  })
}
