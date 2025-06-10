from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.backend.api.v1.api import api_router
from app.backend.core.config import settings
from app.backend.db.session import Base, engine

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="CollabWrite",
    description="A real-time collaborative writing application",
    version="0.1.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
async def root():
    return {"message": "Welcome to CollabWrite API"} 