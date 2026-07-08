# Telecom Analytics AWS Lab

This project is a clone of a related project of mine, which is the
[Cloud-Native Telecom Analytics Platform](https://github.com/doug-sauder/cloud-native-telecom-analytics). Whereas the latter project is directed
towards Kubernetes orchestration, this project explores using alternative
AWS services: RDS, ECS, Fargate, SQS, CloudWatch.

## Documentation

- [AWS RDS Console Setup](docs/aws-rds-console-setup.md) defines the initial
  private VPC and RDS PostgreSQL environment and records the Web Console steps.
- [AWS RDS Schema Initialization](docs/aws-rds-schema-initialization.md) defines
  the private, one-off ECS/Fargate workflow used to apply and validate the
  PostgreSQL schema.
- [AWS ECS Application Runtime](docs/aws-ecs-application-runtime.md) defines the
  first long-running private ECS/Fargate application deployment using SQS,
  CloudWatch Logs, and the initialized RDS database.
