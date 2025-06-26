from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, JSON, event
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.backend.db.session import Base

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    content = Column(JSON)  # Store document content as JSON
    owner_id = Column(Integer, ForeignKey("users.id"))
    version = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    is_public = Column(Boolean, default=False)

    # Relationships
    owner = relationship("User", back_populates="documents")
    collaborators = relationship("DocumentCollaborator", back_populates="document", cascade="all, delete-orphan")

    def update_content(self, new_content: dict) -> None:
        """
        Update document content with version handling
        """
        if not isinstance(new_content, dict):
            raise ValueError("Content must be a dictionary")
            
        if self.content is None:
            self.content = {
                "text": "",
                "characters": [],
                "version": 1
            }
            
        # Ensure content has required fields
        if "text" not in new_content or "characters" not in new_content:
            raise ValueError("Content must include 'text' and 'characters' fields")
            
        # Update content and increment version
        self.content.update(new_content)
        self.version += 1
        self.content["version"] = self.version

@event.listens_for(Document, 'before_update')
def document_before_update(mapper, connection, target):
    """Ensure content is properly structured before update"""
    if target.content is not None and isinstance(target.content, dict):
        if "text" not in target.content:
            target.content["text"] = ""
        if "characters" not in target.content:
            target.content["characters"] = []
        target.content["version"] = target.version

class DocumentCollaborator(Base):
    __tablename__ = "document_collaborators"

    id = Column(Integer, primary_key=True,index=True)  # This will automatically use SERIAL
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))

    # Relationships
    document = relationship("Document", back_populates="collaborators")
    user = relationship("User", back_populates="collaborations")

# class DocumentCollaborator(Base):
#     __tablename__ = "document_collaborators"

#     id = Column(Integer, Identity(always=False), primary_key=True, index=True)
#     document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
#     user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

#     # Relationships
#     document = relationship("Document", back_populates="collaborators")
#     user = relationship("User", back_populates="collaborations")