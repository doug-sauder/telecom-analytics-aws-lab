# ECS cluster mirrors the inspected Fargate-only runtime.
resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

# One-off database initialization task definition.
resource "aws_ecs_task_definition" "db_init" {
  family                   = "${local.name_prefix}-db-init"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.db_init_execution.arn
  task_role_arn            = aws_iam_role.db_init_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "db-init"
      image     = "${aws_ecr_repository.db_init.repository_url}@${var.db_init_image_digest}"
      cpu       = 0
      essential = true
      environment = [
        { name = "PGSSLMODE", value = "verify-full" },
        { name = "PGHOST", value = aws_db_instance.main.address },
        { name = "PGPORT", value = tostring(aws_db_instance.main.port) },
        { name = "PGSSLROOTCERT", value = "/opt/telecom-db-init/certs/global-bundle.pem" },
        { name = "PGDATABASE", value = var.db_name }
      ]
      secrets = [
        {
          name      = "PGPASSWORD"
          valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::"
        },
        {
          name      = "PGUSER"
          valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::"
        },
        {
          name      = "POSTGRES_EXPORTER_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.postgres_exporter.arn}:password::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.db_init.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "db-init"
        }
      }
    }
  ])
}

# Long-running ingest task definition uses the inspected working health check.
resource "aws_ecs_task_definition" "ingest" {
  family                   = "${local.name_prefix}-ingest"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.app_execution.arn
  task_role_arn            = aws_iam_role.ingest_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "ingest"
      image     = "${aws_ecr_repository.ingest.repository_url}@${var.ingest_image_digest}"
      cpu       = 0
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
          name          = "ingest-3000-tcp"
          appProtocol   = "http"
        }
      ]
      environment = [
        { name = "PGHOST", value = aws_db_instance.main.address },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SQS_QUEUE_URL", value = aws_sqs_queue.pm_events.url },
        { name = "PORT", value = "3000" },
        { name = "PGSSLMODE", value = "require" },
        { name = "EVENT_TRANSPORT", value = "sqs" },
        { name = "PGPORT", value = tostring(aws_db_instance.main.port) },
        { name = "NODE_ENV", value = "production" },
        { name = "PGDATABASE", value = var.db_name }
      ]
      secrets = [
        {
          name      = "PGPASSWORD"
          valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::"
        },
        {
          name      = "PGUSER"
          valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ingest.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ingest"
        }
      }
      healthCheck = {
        command = [
          "CMD-SHELL",
          "node -e \"const http = require('http'); const request = http.get('http://127.0.0.1:3000/readyz', function(response) { process.exit(response.statusCode === 200 ? 0 : 1); }); request.on('error', function() { process.exit(1); }); request.setTimeout(5000, function() { request.destroy(); process.exit(1); });\""
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

# Long-running PM generator task definition publishes generated events to SQS.
resource "aws_ecs_task_definition" "pmgen" {
  family                   = "${local.name_prefix}-pmgen"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.app_execution.arn
  task_role_arn            = aws_iam_role.pmgen_task.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "pmgen"
      image     = "${aws_ecr_repository.pmgen.repository_url}@${var.pmgen_image_digest}"
      cpu       = 0
      essential = true
      portMappings = [
        {
          containerPort = 8000
          hostPort      = 8000
          protocol      = "tcp"
          name          = "pmgen-8000-tcp"
          appProtocol   = "http"
        }
      ]
      environment = [
        { name = "PMGEN_SQS_QUEUE_URL", value = aws_sqs_queue.pm_events.url },
        { name = "PMGEN_PROMETHEUS_PORT", value = "8000" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "PMGEN_EVENT_TRANSPORT", value = "sqs" },
        { name = "PMGEN_INTERVAL_SECONDS", value = "5" },
        { name = "PMGEN_CELL_COUNT", value = "50" },
        { name = "PMGEN_SOURCE", value = "pmgen-ecs" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.pmgen.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "pmgen"
        }
      }
    }
  ])
}

# ECS services are optional so a clean account can create repositories before images exist.
resource "aws_ecs_service" "ingest" {
  count = var.create_ecs_services ? 1 : 0

  name            = "ingest"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ingest.arn
  desired_count   = var.ingest_desired_count

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.app : subnet.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  enable_ecs_managed_tags = true
  propagate_tags          = "NONE"

  depends_on = [
    aws_ecs_cluster_capacity_providers.main,
    aws_iam_role_policy.ingest_sqs,
    aws_iam_role_policy.app_execution_master_secret
  ]
}

resource "aws_ecs_service" "pmgen" {
  count = var.create_ecs_services ? 1 : 0

  name            = "pmgen"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.pmgen.arn
  desired_count   = var.pmgen_desired_count

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.app : subnet.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  enable_ecs_managed_tags = true
  propagate_tags          = "NONE"

  depends_on = [
    aws_ecs_cluster_capacity_providers.main,
    aws_iam_role_policy.pmgen_sqs
  ]
}
