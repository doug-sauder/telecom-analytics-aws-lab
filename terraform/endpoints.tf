# Gateway endpoint for S3 has no hourly endpoint charge and supports private ECR layer pulls.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.app.id]

  tags = {
    Name = "${local.name_prefix}-s3-vpce"
  }
}

# Interface endpoints are useful for a no-NAT private ECS design but carry hourly costs.
resource "aws_vpc_endpoint" "interface" {
  for_each = var.create_interface_endpoints ? local.interface_endpoint_services : {}

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value.service}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.app : subnet.id]
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  ip_address_type     = "ipv4"

  dns_options {
    dns_record_ip_type = "ipv4"
  }

  tags = {
    Name = each.value.name
  }
}
