import json

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

def init_db(app):
    db.init_app(app)
    with app.app_context():
        # Transcript deletion is no longer supported. Remove legacy tombstones
        # so an upgraded database cannot retain or consult deletion history.
        with db.engine.begin() as connection:
            connection.exec_driver_sql("DROP TABLE IF EXISTS deleted_transcripts")
            inspector = inspect(connection)
            if (
                'semesters' in inspector.get_table_names()
                and 'description' in {column['name'] for column in inspector.get_columns('semesters')}
            ):
                connection.exec_driver_sql("ALTER TABLE semesters DROP COLUMN description")
            inspector = inspect(connection)
            if (
                'schedule_activities' in inspector.get_table_names()
                and 'blocking' in {column['name'] for column in inspector.get_columns('schedule_activities')}
            ):
                activities = connection.exec_driver_sql(
                    "SELECT uuid, blocking, time_entries FROM schedule_activities"
                ).fetchall()
                for activity_uuid, blocking, raw_entries in activities:
                    try:
                        entries = json.loads(raw_entries) if isinstance(raw_entries, str) else (raw_entries or [])
                    except (TypeError, json.JSONDecodeError):
                        entries = []
                    for entry in entries:
                        if isinstance(entry, dict):
                            entry.setdefault('blocking', bool(blocking))
                    connection.exec_driver_sql(
                        "UPDATE schedule_activities SET time_entries = ? WHERE uuid = ?",
                        (json.dumps(entries, ensure_ascii=False), activity_uuid),
                    )
                connection.exec_driver_sql("ALTER TABLE schedule_activities DROP COLUMN blocking")
        db.create_all()
        try:
            from college_english import seed_default_pool

            seed_default_pool(reset=False)
        except Exception as exc:
            app.logger.warning("Failed to seed college English pool: %s", exc)
        try:
            from labor_education import seed_default_pool

            seed_default_pool(reset=False)
        except Exception as exc:
            app.logger.warning("Failed to seed labor education pool: %s", exc)
