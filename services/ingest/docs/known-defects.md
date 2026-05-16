# Ingest Service Known Defects

This document tracks known defects that are accepted for now so the project can
continue moving. In a real project, engineering staff would fix these flaws. For
this project, these are minor flaws that do not affect the underlying goals of
the project, namely, to gain hands-on experience in cloud-native technologies.

## 1. Incomplete Event Validation Can Allow Database-Level Data Errors

Status: known, unresolved

Root cause: service-level event validation is incomplete compared with the event
contract and PostgreSQL schema.

Related issues:

- The event contract implies validation that the service does not perform.
- PostgreSQL failure behavior misses non-connectivity data errors.

Current behavior:

- The ingest service validates only a small part of the event contract before
  persistence.
- `event_time`, `entity_id`, and object-shaped `metrics` are checked by the
  service.
- Other fields are not fully validated before insert, including `event_id`,
  `schema_version`, `source`, `entity_type`, and metric value types.
- A Kafka message with invalid-but-not-rejected data can pass service validation
  and then fail during PostgreSQL insertion.

Example failure cases:

- `event_id` is present but is not a valid UUID.
- `schema_version` is present but is not an integer.
- `event_time` parses in JavaScript but violates a database constraint.

Impact:

- PostgreSQL can reject an entire Kafka insert batch for a data-quality error.
- The batch error prevents successful offset commit.
- The same bad message can be redelivered and fail repeatedly.
- This weakens the intended poison-message policy, where invalid messages should
  be counted, logged, skipped, and not allowed to block later messages.

Expected future fix:

- Expand service-level validation so events that cannot satisfy the database
  schema are rejected before insertion.
- Count and log these failures as validation rejections.
- Keep database constraints as a final safety boundary, not the first place
  routine input validation failures are discovered.
