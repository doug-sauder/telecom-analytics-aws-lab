# PM event queues reproduce the inspected SQS standard queue and DLQ behavior.
resource "aws_sqs_queue" "pm_events_dlq" {
  name                      = "${local.name_prefix}-pm-events-dlq"
  message_retention_seconds = 345600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "pm_events" {
  name                       = "${local.name_prefix}-pm-events"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.pm_events_dlq.arn
    maxReceiveCount     = 5
  })
}
