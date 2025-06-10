from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.backend.core.config import settings

engine = create_engine(settings.get_database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 