from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

def init_db(app):
    db.init_app(app)
    with app.app_context():
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
