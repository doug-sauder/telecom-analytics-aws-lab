import asyncio
import json
import logging
import signal

from pmgen.transport import HttpEventSender, KafkaEventSender
import typer

from prometheus_client import start_http_server

from pmgen.admin_server import start_admin_http_server
from pmgen.config import RuntimeConfig
from pmgen.generator import EventGenerator
from pmgen.runtime import PmgenRuntime

app = typer.Typer(help="Synthetic PM event generator.")
config_app = typer.Typer(help="Configuration helpers.")
app.add_typer(config_app, name="config")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

@app.command("produce")
def produce() -> None:
    """Generate Kafka events and produce them to the configured topic."""
    _setup_logging()
    config = RuntimeConfig()
    print(f"Producing events to Kafka broker {config.kafka_broker} on topic {config.kafka_topic}")
    runtime = PmgenRuntime(config, KafkaEventSender(config))
    start_admin_http_server(config.prometheus_port)
    asyncio.run(_run_with_signals(runtime))


@app.command("run")
def run() -> None:
    """Continuously generate and send PM events via HTTP."""
    _setup_logging()
    config = RuntimeConfig()
    runtime = PmgenRuntime(config, HttpEventSender(config))
    start_http_server(config.prometheus_port)
    asyncio.run(_run_with_signals(runtime))


async def _run_with_signals(runtime: PmgenRuntime) -> None:
    loop = asyncio.get_running_loop()
    # Stop the async loop cleanly so the HTTP client can close before exit.
    for signame in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signame, runtime.stop)
    await runtime.run_forever()


@app.command("generate-once")
def generate_once(
    pretty: bool = typer.Option(False, help="Pretty-print the event JSON."),
) -> None:
    """Generate one PM event and write it to stdout."""
    config = RuntimeConfig()
    event = EventGenerator(config).next_event()
    payload = event.model_dump(mode="json")
    typer.echo(json.dumps(payload, indent=2 if pretty else None))


@config_app.command("show")
def show_config() -> None:
    """Print the effective runtime configuration."""
    config = RuntimeConfig()
    typer.echo(json.dumps(config.model_dump(mode="json"), indent=2))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
