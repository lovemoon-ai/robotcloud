"""Management command to check and downgrade expired subscriptions."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from robotcloud_backend.api.models import User


class Command(BaseCommand):
    help = "Check for expired Plus/Pro subscriptions and downgrade to Free"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without making changes",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        now = timezone.now()

        expired_users = User.objects.filter(
            role__in=[User.ROLE_PLUS, User.ROLE_PRO],
            expire_at__lt=now,
        )

        count = expired_users.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS("No expired subscriptions found."))
            return

        if dry_run:
            self.stdout.write(f"Would downgrade {count} user(s):")
            for user in expired_users:
                self.stdout.write(f"  - {user.phone} ({user.role}, expired {user.expire_at})")
        else:
            for user in expired_users:
                old_role = user.role
                user.role = User.ROLE_FREE
                user.expire_at = None
                user.save(update_fields=["role", "expire_at"])
                self.stdout.write(f"Downgraded {user.phone} from {old_role} to free")

            self.stdout.write(self.style.SUCCESS(f"Downgraded {count} user(s) to free."))
