from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0016_workernode_gpu_slots"),
    ]

    operations = [
        migrations.AddField(
            model_name="traintask",
            name="job_name",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
    ]
