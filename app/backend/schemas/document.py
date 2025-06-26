from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, validator

class DocumentContent(BaseModel):
    text: str = ""
    characters: List[Dict[str, Any]] = []
    version: int = 1

# Shared properties
class DocumentBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: Optional[DocumentContent] = None
    is_public: bool = False

    @validator('content', pre=True)
    def validate_content(cls, v):
        if v is None:
            return DocumentContent()
        if isinstance(v, dict):
            return DocumentContent(**v)
        return v

# Properties to receive on document creation
class DocumentCreate(DocumentBase):
    pass

# Properties to receive on document update
class DocumentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    content: Optional[DocumentContent] = None
    is_public: Optional[bool] = None

    @validator('content', pre=True)
    def validate_content(cls, v):
        if v is None:
            return None
        if isinstance(v, dict):
            return DocumentContent(**v)
        return v

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

# Properties for collaborator responses
class CollaboratorResponse(BaseModel):
    user_id: int
    username : str
    email:str
    # document_id: int
    # created_at: datetime

    class Config:
        from_attributes = True

# Document with collaborators
class DocumentWithCollaborators(Document):
    collaborators: List[CollaboratorResponse] = [] 