from __future__ import annotations

from django.db import migrations


def ensure_api_port_column(apps, schema_editor) -> None:
    """Add the api_port column for WorkerNode if the database is missing it.

    The initial version of migration 0004 shipped without the api_port column,
    so environments that ran that migration before the field was added never
    created the column. Later migrations already expect it to exist, so we
    patch the existing schema rather than rewriting history.
    """

    worker_node_model = apps.get_model("api", "WorkerNode")
    table_name = worker_node_model._meta.db_table
    column_name = "api_port"

    connection = schema_editor.connection
    with connection.cursor() as cursor:
        existing_columns = {
            column.name for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if column_name in existing_columns:
        return

    quoted_table = schema_editor.quote_name(table_name)
    quoted_column = schema_editor.quote_name(column_name)

    # Use ALTER TABLE so existing rows get the default value of 5000.
    schema_editor.execute(
        f"ALTER TABLE {quoted_table} ADD COLUMN {quoted_column} INTEGER NOT NULL DEFAULT 5000"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0004_workernode_traintask_assigned_gpus_and_more"),
    ]

    operations = [
        migrations.RunPython(ensure_api_port_column, migrations.RunPython.noop),
    ]
