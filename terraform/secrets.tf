# Exporter credentials are generated for clean-slate rebuilds and stored in Secrets Manager.
resource "random_password" "postgres_exporter" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "postgres_exporter" {
  name        = "${var.project_name}/${var.environment}/postgres-exporter"
  description = "Credentials for the postgres-exporter"

  tags = {
    name = "postgres-exporter"
  }
}

resource "aws_secretsmanager_secret_version" "postgres_exporter" {
  secret_id = aws_secretsmanager_secret.postgres_exporter.id

  secret_string = jsonencode({
    username = "postgres_exporter"
    password = random_password.postgres_exporter.result
  })
}
