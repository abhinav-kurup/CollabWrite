from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.backend.db.session import Base

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    content = Column(JSON)  # Store CRDT data as JSON
    owner_id = Column(Integer, ForeignKey("users.id"))
    version = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    is_public = Column(Boolean, default=False)

    # Relationships
    owner = relationship("User", back_populates="documents")
    collaborators = relationship("DocumentCollaborator", back_populates="document", cascade="all, delete-orphan")

class DocumentCollaborator(Base):
    __tablename__ = "document_collaborators"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    user_id = Column(Integer, ForeignKey("users.id"))

    # Relationships
    document = relationship("Document", back_populates="collaborators")
    user = relationship("User", back_populates="collaborations") 