from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0017_traintask_job_name"),
    ]

    operations = [
        migrations.AlterField(
            model_name="usersession",
            name="device_type",
            field=models.CharField(
                choices=[("browser", "Browser"), ("mobile", "Mobile"), ("desktop", "Desktop")],
                max_length=16,
            ),
        ),
    ]
