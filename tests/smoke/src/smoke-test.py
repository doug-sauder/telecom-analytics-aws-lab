import requests
from sys import exit

PROMETHEUS_API_ENDPOINT = "http://prometheus:9090/api/v1/query"
EXPECTED_PROMETHEUS_JOBS = {
    "ingest",
    "pmgen",
    "postgres",
    "prometheus",
    "redpanda",
}


# Prometheus response helpers
def parse_prometheus_up_results(response_body):
    # Build a service-to-value lookup from the Prometheus vector response.
    results = response_body.get("data", {}).get("result", [])
    up_results_by_job = {}

    for result in results:
        metric_labels = result.get("metric", {})
        job_name = metric_labels.get("job")
        sample = result.get("value", [])

        if not job_name or len(sample) < 2:
            continue

        up_results_by_job[job_name] = sample[1]

    return up_results_by_job


def validate_expected_up_metrics(response_body):
    # Confirm every expected service has an up metric and is scrapeable.
    response_status = response_body.get("status")
    if response_status != "success":
        print("Error: Prometheus query failed. Response status:", response_status)
        exit(1)

    up_results_by_job = parse_prometheus_up_results(response_body)

    missing_jobs = EXPECTED_PROMETHEUS_JOBS - set(up_results_by_job.keys())
    if missing_jobs:
        sorted_missing_jobs = sorted(missing_jobs)
        print("Error: Prometheus did not return up metrics for:", sorted_missing_jobs)
        exit(1)

    down_jobs = []
    for job_name in sorted(EXPECTED_PROMETHEUS_JOBS):
        up_value = up_results_by_job[job_name]
        if up_value != "1":
            down_jobs.append(job_name)

    if down_jobs:
        print("Error: Prometheus reported down targets for:", down_jobs)
        exit(1)

    print("Prometheus up metrics verified for:", sorted(EXPECTED_PROMETHEUS_JOBS))


def check_prometheus_scrapes():
    # Check that Prometheus can scrape the all targets
    try:
        response = requests.get(
            PROMETHEUS_API_ENDPOINT,
            params={"query": "up"},
            timeout=30,
        )
    except requests.Timeout:
        print("Error: Connection to Prometheus timed out.")
        exit(1)
    except requests.ConnectionError:
        print("Error: Failed connect to Prometheus.")
        exit(1)
    except Exception as e:
        print("Error: An unexpected error occurred while connecting to Prometheus:", str(e))
        exit(1)
    if response.status_code != 200:
        print("Error: Prometheus is not responding. Status code:", response.status_code)
        exit(1)

    try:
        response_body = response.json()
    except requests.JSONDecodeError:
        print("Error: Prometheus returned an invalid JSON response.")
        exit(1)

    validate_expected_up_metrics(response_body)


def main():
    check_prometheus_scrapes()
    print("Test complete")

if __name__ == '__main__':
    main()
