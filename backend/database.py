from flask_sqlalchemy import SQLAlchemy
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
