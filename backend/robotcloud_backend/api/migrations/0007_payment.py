# Generated manually for adding Payment model
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0006_dataset_metadata"),
    ]

    operations = [
        migrations.CreateModel(
            name="Payment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("payment_id", models.CharField(max_length=64, unique=True)),
                ("target_role", models.CharField(choices=[("free", "Free"), ("plus", "Plus"), ("pro", "Pro"), ("admin", "Admin")], max_length=16)),
                ("amount_cents", models.IntegerField()),
                ("currency", models.CharField(default="CNY", max_length=8)),
                ("provider", models.CharField(default="mock", max_length=32)),
                ("provider_reference", models.CharField(blank=True, max_length=128)),
                ("description", models.CharField(blank=True, max_length=255)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("succeeded", "Succeeded"), ("failed", "Failed"), ("canceled", "Canceled")], default="pending", max_length=16)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payments", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
