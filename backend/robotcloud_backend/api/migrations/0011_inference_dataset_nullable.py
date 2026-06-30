from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0010_inference_fields_and_train_checkpoint"),
    ]

    operations = [
        migrations.AlterField(
            model_name="inferencetask",
            name="dataset",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name="inference_tasks",
                to="api.dataset",
            ),
        ),
    ]
