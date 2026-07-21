# Private ECR repositories hold images built outside Terraform.
resource "aws_ecr_repository" "db_init" {
  name                 = "${var.project_name}/db-init"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${var.project_name}/db-init"
  }
}

resource "aws_ecr_repository" "ingest" {
  name                 = "${var.project_name}/ingest"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${var.project_name}/ingest"
  }
}

resource "aws_ecr_repository" "pmgen" {
  name                 = "${var.project_name}/pmgen"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${var.project_name}/pmgen"
  }
}
