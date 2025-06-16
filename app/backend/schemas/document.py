from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# Shared properties
class DocumentBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: Optional[Dict[str, Any]] = None
    is_public: bool = False

# Properties to receive on document creation
class DocumentCreate(DocumentBase):
    pass

# Properties to receive on document update
class DocumentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    content: Optional[Dict[str, Any]] = None
    is_public: Optional[bool] = None

# Properties shared by models stored in DB
class DocumentInDBBase(DocumentBase):
    id: int
    owner_id: int
    version: int
    created_at: datetime
    updated_at: datetime
    is_deleted: bool

    class Config:
        from_attributes = True

# Properties to return to client
class Document(DocumentInDBBase):
    pass

# Properties stored in DB
class DocumentInDB(DocumentInDBBase):
    pass

# Collaborator response
class CollaboratorResponse(BaseModel):
    user_id: int
    username: str
    email: str

# Document with collaborators
class DocumentWithCollaborators(Document):
    collaborators: List[CollaboratorResponse] = [] 