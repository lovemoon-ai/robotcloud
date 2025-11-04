from __future__ import annotations

import logging

from django.core.management.base import BaseCommand

from ...scheduler import SchedulerService


class Command(BaseCommand):
    help = "Run the RobotCloud training scheduler loop."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--interval",
            type=float,
            default=1.0,
            help="Scheduler loop interval in seconds (default: 1.0).",
        )
        parser.add_argument(
            "--heartbeat-timeout",
            type=int,
            default=120,
            help="Heartbeat timeout in seconds before marking nodes offline.",
        )
        parser.add_argument(
            "--max-retries",
            type=int,
            default=3,
            help="Maximum times a training task will be retried before failing.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run a single scheduler cycle and exit (useful for cronjobs/tests).",
        )

    def handle(self, *args, **options) -> None:
        interval: float = options["interval"]
        heartbeat_timeout: int = options["heartbeat_timeout"]
        max_retries: int = options["max_retries"]
        dry_run: bool = options["dry_run"]

        logger = logging.getLogger("robotcloud.scheduler")
        if not logger.handlers:
            handler = logging.StreamHandler(self.stdout)
            handler.setLevel(logging.INFO)
            logger.addHandler(handler)
        logger.setLevel(logging.INFO)

        scheduler = SchedulerService(
            loop_interval=interval,
            heartbeat_timeout=heartbeat_timeout,
            max_retries=max_retries,
            logger=logger,
        )

        if dry_run:
            assigned = scheduler.perform_scheduling_cycle()
            self.stdout.write(self.style.SUCCESS(f"Scheduler cycle completed. Assigned tasks: {assigned}"))
            return

        self.stdout.write(self.style.SUCCESS("Starting scheduler loop. Press Ctrl+C to exit."))
        try:
            scheduler.run_forever()
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Scheduler interrupted by user."))
