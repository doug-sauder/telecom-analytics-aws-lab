# AWS RDS Console Setup

## 1. Purpose

This runbook explains how to create the initial AWS foundation for the Telecom Analytics
AWS Lab by using the AWS Management Console. The first workload is a private Amazon RDS
for PostgreSQL database that will eventually replace the PostgreSQL container in the
local Docker Compose environment.

This stage provisions the database and its network boundary. It intentionally
does not make the database publicly accessible and does not yet connect the
local services to it. A later stage will run a database initialization task and
the `ingest` service inside the VPC.

## 2. Design Decisions

- Use a dedicated VPC rather than the account's default VPC.
- Reserve separate public, application, and database subnet ranges.
- Spread each subnet tier across two Availability Zones.
- Keep RDS in private database subnets with no route to an internet gateway.
- Authorize PostgreSQL traffic by application security group, not by IP range.
- Use a small, Single-AZ RDS instance appropriate for a disposable lab.
- Let RDS manage the master password in AWS Secrets Manager.
- Encrypt database storage and backups with the AWS-managed KMS key.
- Do not create a NAT gateway yet. It has an hourly cost and is not needed by
  the database.
- Record all resource names, IDs, and deviations in the worksheet below.

The two-AZ subnet layout allows later Multi-AZ RDS and ECS deployment without
redesigning the network. The RDS instance itself remains Single-AZ to control
lab cost.

## 3. Preconditions

Before creating resources:

1. Sign in with an IAM identity that can administer VPC, RDS, Secrets Manager,
   and KMS resources. Do not use the account root user for routine work.
2. Select one AWS Region and keep the Console in that Region throughout the
   procedure.
3. Create an AWS cost budget with actual and forecast notifications.
4. Confirm that the VPC CIDR `10.20.0.0/16` does not overlap a network that may
   later connect to this VPC.

Suggested tags for resources that support them:

| Key | Value |
| --- | --- |
| `Project` | `telecom-analytics-aws-lab` |
| `Environment` | `dev` |
| `ManagedBy` | `console` |
| `Owner` | AWS account owner or team name |

## 4. Target Resource Specification

### 4.1 Network

Replace `<region>` and the example Availability Zones with values for the
selected Region. Choose two distinct AZs.

| Resource | Name | Specification |
| --- | --- | --- |
| VPC | `telecom-analytics-dev-vpc` | IPv4 CIDR `10.20.0.0/16`; default tenancy; DNS resolution enabled; DNS hostnames enabled |
| Internet gateway | `telecom-analytics-dev-igw` | Attached to the VPC; used only by the public route table |
| Public subnet A | `telecom-analytics-dev-public-a` | `10.20.0.0/24`; AZ A; auto-assign public IPv4 disabled |
| Public subnet B | `telecom-analytics-dev-public-b` | `10.20.1.0/24`; AZ B; auto-assign public IPv4 disabled |
| Application subnet A | `telecom-analytics-dev-app-a` | `10.20.10.0/24`; AZ A; private |
| Application subnet B | `telecom-analytics-dev-app-b` | `10.20.11.0/24`; AZ B; private |
| Database subnet A | `telecom-analytics-dev-db-a` | `10.20.20.0/24`; AZ A; private |
| Database subnet B | `telecom-analytics-dev-db-b` | `10.20.21.0/24`; AZ B; private |
| Public route table | `telecom-analytics-dev-public-rt` | Associate both public subnets; add `0.0.0.0/0` to the internet gateway |
| Application route table | `telecom-analytics-dev-app-rt` | Associate both application subnets; local VPC route only for now |
| Database route table | `telecom-analytics-dev-db-rt` | Associate both database subnets; local VPC route only |
| DB subnet group | `telecom-analytics-dev-db-subnets` | Contains only database subnets A and B |

No NAT gateway is part of this stage. Before private ECS tasks are introduced,
choose either NAT-based outbound access or the required VPC endpoints. That is
a separate architecture and cost decision.

### 4.2 Security Groups

| Security group | Inbound rules | Outbound rules | Purpose |
| --- | --- | --- | --- |
| `telecom-analytics-dev-app-sg` | None initially | Default: all traffic | Future ECS tasks that need database access |
| `telecom-analytics-dev-rds-sg` | PostgreSQL TCP `5432`, source `telecom-analytics-dev-app-sg` | Default: all traffic | RDS network boundary |

Do not add `0.0.0.0/0`, the VPC CIDR, or a personal public IP address to the RDS
inbound rules. Security-group references preserve least privilege when ECS task
IP addresses change.

### 4.3 RDS PostgreSQL

| Setting | Value |
| --- | --- |
| Creation method | Standard create |
| Engine | PostgreSQL |
| Engine version | Latest PostgreSQL `18.x` offered in the Region, to match local PostgreSQL 18; record the exact version |
| Template | Dev/Test |
| Availability | Single DB instance; no Multi-AZ standby |
| DB instance identifier | `telecom-analytics-dev` |
| Master username | `telecom_admin` |
| Credentials | Managed by RDS in AWS Secrets Manager |
| Secret encryption | Default AWS-managed key unless there is a specific customer-managed-key requirement |
| Instance class | Burstable classes, `db.t4g.micro`; use the smallest available equivalent if the Region does not offer it for PostgreSQL 18 |
| Storage type | General Purpose SSD (`gp3`) |
| Allocated storage | `20 GiB` |
| Storage autoscaling | Enabled; maximum `100 GiB` |
| Storage encryption | Enabled, AWS-managed RDS KMS key |
| VPC | `telecom-analytics-dev-vpc` |
| DB subnet group | `telecom-analytics-dev-db-subnets` |
| Public access | No |
| VPC security group | Existing: `telecom-analytics-dev-rds-sg`; remove the default security group if automatically selected |
| Database port | `5432` |
| Initial database name | `telecom` |
| DB parameter group | Default PostgreSQL parameter group |
| Option group | Default, if displayed |
| Automated backups | Enabled |
| Backup retention | `7 days` |
| Backup window | No preference for the first pass; record the assigned window |
| Copy tags to snapshots | Enabled |
| Performance Insights | Disabled initially to avoid optional feature cost; use standard monitoring first |
| Enhanced Monitoring | Disabled initially |
| PostgreSQL log exports | `postgresql` and `upgrade`, if offered |
| Auto minor version upgrade | Enabled |
| Maintenance window | No preference for the first pass; record the assigned window |
| Deletion protection | Disabled for this disposable lab |
| Final snapshot on deletion | Skip for disposable test data; never use this policy for valuable data |

RDS settings and available instance classes vary by Region and engine version.
If the Console does not offer a listed value, choose the closest low-cost value
and record the deviation rather than silently changing the design.

### 4.4 Cost Notes

- The RDS instance and allocated storage are the main recurring costs in this
  stage, even when the database is idle.
- An RDS-managed secret incurs the normal Secrets Manager secret charge.
- CloudWatch log ingestion and retention can incur charges when database log
  exports are enabled.
- The VPC, subnets, route tables, security groups, and internet gateway do not
  have an hourly charge by themselves.
- This design creates no NAT gateway and allocates no public IPv4 address.
- AWS Budgets provides notifications; it does not impose a hard spending cap.

Review the current prices for the selected Region and the Console estimate
before creating the database. Delete the RDS instance when the lab is not in
use for an extended period.

## 5. Console Procedure

### 5.1 Create the VPC and Subnets

1. Open **VPC > Your VPCs > Create VPC**.
2. Choose **VPC only** and enter the VPC specification from section 4.1.
3. After creation, select the VPC and verify that both **DNS resolution** and
   **DNS hostnames** are enabled under VPC settings.
4. Open **VPC > Subnets > Create subnet**.
5. Create all six subnets from section 4.1. Ensure that the A subnets share one
   AZ and the B subnets share the other AZ.
6. Verify that **auto-assign public IPv4 address** is disabled on every subnet.

Creating public and application subnets now records the intended network
layout. They do not incur an hourly charge merely by existing.

### 5.2 Create Routing

1. Open **VPC > Internet gateways > Create internet gateway**.
2. Name and tag the gateway, then attach it to the lab VPC.
3. Open **VPC > Route tables > Create route table** and create the public,
   application, and database route tables from section 4.1.
4. Associate each pair of subnets with its corresponding route table.
5. On the public route table only, add destination `0.0.0.0/0` with the internet
   gateway as the target.
6. Confirm that the application and database route tables contain only the
   automatically created `10.20.0.0/16` local route.

The internet gateway and public route are groundwork for a later load balancer.
No database subnet is associated with the public route table.

### 5.3 Create Security Groups

1. Open **VPC > Security groups > Create security group**.
2. Create `telecom-analytics-dev-app-sg` in the lab VPC with no inbound rules.
3. Create `telecom-analytics-dev-rds-sg` in the lab VPC.
4. Add one inbound rule to the RDS group:
   - Type: **PostgreSQL**
   - Protocol and port: **TCP 5432**
   - Source: the ID of `telecom-analytics-dev-app-sg`
5. Add descriptions to the groups and rule, and apply the standard tags.

### 5.4 Create the DB Subnet Group

1. Open **RDS > Subnet groups > Create DB subnet group**.
2. Enter the name and description from section 4.1.
3. Select the lab VPC.
4. Select the two AZs used by database subnets A and B.
5. Select only `telecom-analytics-dev-db-a` and
   `telecom-analytics-dev-db-b`, then create the group.

RDS requires a DB subnet group spanning at least two AZs even though this lab
uses a Single-AZ DB instance.

### 5.5 Create the RDS Instance

1. Open **RDS > Databases > Create database**.
2. Choose **Standard create** and **PostgreSQL**.
3. Apply every setting from section 4.3. Expand **Additional configuration** to
   set the initial database name, backups, monitoring, maintenance, log exports,
   and deletion behavior.
4. Review the Console's **Estimated monthly costs** panel before creation.
5. Choose **Create database**.
6. Wait for the database status to become **Available**.

Do not use **Easy create** because it hides decisions this exercise is intended
to make explicit.

## 6. Post-Creation Verification

Record and verify the following without displaying the secret value:

1. Under **RDS > Databases > telecom-analytics-dev > Connectivity & security**:
   - Publicly accessible is **No**.
   - The VPC and subnet group are the lab resources.
   - The RDS security group is attached.
   - The endpoint exists and the port is `5432`.
2. Under **Configuration**:
   - The engine version and instance class match the worksheet.
   - Storage and encryption are enabled as specified.
   - The initial database name is `telecom`.
   - A master-credentials secret ARN is present.
3. Under **Maintenance & backups**:
   - Automated backups and seven-day retention are enabled.
4. Under **Secrets Manager**:
   - The RDS-managed secret exists and is tagged for the project.
   - Do not copy the secret value into this repository or the worksheet.
5. Under **VPC > Security groups**:
   - The only RDS inbound rule is TCP 5432 from the application security group.

The database is not expected to accept a connection from the local workstation.
That failure is a consequence of the private network design, not a failed setup.

## 7. Schema Initialization Boundary

The following repository files must eventually be applied, in order, to the
`telecom` database:

1. `infra/db/01-schema.sql`
2. `infra/db/02-monitoring-user.sql`

Do not paste these files into an ad hoc public database connection. The next
implementation stage should create an auditable one-off task inside the VPC to
read the RDS-managed secret, connect with TLS, apply the SQL, and run validation
queries. That task can also establish the deployment pattern later used by ECS.

## 8. Build Worksheet

Complete this table during the Console exercise. Resource IDs and ARNs are not
secrets, but account IDs embedded in ARNs may be omitted before public sharing.

| Item | Recorded value |
| --- | --- |
| AWS account alias or label | `<account-label>` |
| Region | `<region>` |
| AZ A / AZ B | `<az-a>` / `<az-b>` |
| VPC ID | `<vpc-id>` |
| Six subnet IDs | `<subnet-id-1>` <br/> `<subnet-id-2>` <br/> `<subnet-id-3>` <br/> `<subnet-id-4>` <br/> `<subnet-id-5>` <br/> `<subnet-id-6>` |
| Three route table IDs | `<route-table-id-1>` <br/> `<route-table-id-2>` <br/> `<route-table-id-3>` |
| Internet gateway ID | `<internet-gateway-id>` |
| Application security group ID | `<application-security-group-id>` |
| RDS security group ID | `<rds-security-group-id>` |
| DB subnet group | telecom-analytics-dev-db-subnets |
| RDS endpoint | `<rds-endpoint>:5432` |
| RDS resource ID | `<rds-resource-id>` |
| Exact PostgreSQL version | `<postgres-version>` |
| DB instance class | db.t4g.micro |
| Allocated storage | 20 GiB |
| Backup window | `<backup-window>` |
| Maintenance window | `<maintenance-window>` |
| Master secret name or ARN | `<rds-managed-secret-name-or-arn>` |
| Monthly cost estimate shown by Console | `<monthly-cost-estimate>` |
| Deviations from this runbook | |

## 9. Teardown

For a complete teardown, delete resources in dependency order:

1. Delete the RDS instance, skipping the final snapshot only if the data is
   disposable. Confirm that automated backups should also be removed.
2. Confirm the RDS-managed secret is scheduled for deletion, or delete it from
   Secrets Manager if RDS did not do so.
3. Delete the DB subnet group.
4. Delete the RDS and application security groups.
5. Delete the six subnets.
6. Delete the three custom route tables.
7. Detach and delete the internet gateway.
8. Delete the VPC.
9. Check the RDS, EC2/VPC, Secrets Manager, KMS, and CloudWatch consoles for
   retained billable resources.

## 10. AWS References

- [Create a VPC](https://docs.aws.amazon.com/vpc/latest/userguide/create-vpc.html)
- [Create an RDS DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html)
- [Control RDS access with security groups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html)
- [Manage RDS master credentials with Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)
- [RDS DB instance storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)
