from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.backend.db.base_class import Base

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    is_public = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    # Relationships
    owner = relationship("User", back_populates="documents")
    collaborators = relationship(
        "User",
        secondary="document_collaborators",
        back_populates="shared_documents"
    )

class DocumentCollaborator(Base):
    __tablename__ = "document_collaborators"

    document_id = Column(Integer, ForeignKey("documents.id"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    can_edit = Column(Boolean, default=True, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False) 