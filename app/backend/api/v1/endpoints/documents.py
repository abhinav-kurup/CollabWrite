from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.backend.api.deps import get_db, get_current_user
from app.backend.models.user import User
from app.backend.models.document import Document, DocumentCollaborator
from app.backend.schemas.document import (
    Document as DocumentSchema,
    DocumentCreate,
    DocumentUpdate,
    DocumentWithCollaborators,
    CollaboratorResponse
)

router = APIRouter()

@router.post("/", response_model=DocumentSchema)
def create_document(
    *,
    db: Session = Depends(get_db),
    document_in: DocumentCreate,
    current_user: User = Depends(get_current_user)
) -> Document:
    """
    Create new document.
    """
    document = Document(
        **document_in.model_dump(),
        owner_id=current_user.id
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document

@router.get("/", response_model=List[DocumentSchema])
def read_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100
) -> List[Document]:
    """
    Retrieve documents.
    """
    documents = (
        db.query(Document)
        .filter(
            (Document.owner_id == current_user.id) |
            (Document.is_public == True) |
            (Document.collaborators.any(DocumentCollaborator.user_id == current_user.id))
        )
        .filter(Document.is_deleted == False)
        .offset(skip)
        .limit(limit)
        .all()
    )
    if not documents:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    print("Documents: ",type(documents))
    return documents

@router.get("/{document_id}", response_model=DocumentWithCollaborators)
def read_document(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    current_user: User = Depends(get_current_user)
) -> DocumentWithCollaborators:
    """
    Get document by ID.
    """
    document = db.query(Document).filter(Document.id == document_id, Document.is_deleted == False).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    # Check if user has access to the document
    is_collaborator = db.query(DocumentCollaborator).filter(
        DocumentCollaborator.document_id == document_id,
        DocumentCollaborator.user_id == current_user.id
    ).first() is not None
    
    if (
        document.owner_id != current_user.id and
        not document.is_public and
        not is_collaborator
    ):
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    # Get collaborator IDs
    collaborator_ids = [
        c.user_id for c in document.collaborators
    ]
    # Create response with collaborators
    document_dict = {
        "id": document.id,
        "title": document.title,
        "content": document.content,
        "owner_id": document.owner_id,
        "version": document.version,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "is_deleted": document.is_deleted,
        "is_public": document.is_public,
        "collaborators": collaborator_ids
    }
    return DocumentWithCollaborators(**document_dict)

@router.put("/{document_id}", response_model=DocumentSchema)
def update_document(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    document_in: DocumentUpdate,
    current_user: User = Depends(get_current_user)
) -> Document:
    """
    Update document.
    """
    print(f"Updating document {document_id}")
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    if document.owner_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    
    update_data = document_in.model_dump(exclude_unset=True)
    print(f"Update data: {update_data}")
    
    # Handle content update
    if 'content' in update_data:
        content = update_data['content']
        print(f"Content update: {content}")
        if isinstance(content, dict):
            # Always preserve the characters array from the update
            update_data['content'] = {
                'text': content.get('text', ''),
                'characters': content.get('characters', []),
                'version': content.get('version', document.version)
            }
            print(f"Updated content structure: {update_data['content']}")
    
    for field, value in update_data.items():
        setattr(document, field, value)
    
    document.version += 1
    db.add(document)
    db.commit()
    db.refresh(document)
    print(f"Updated document: {document.content}")
    return document

@router.delete("/{document_id}", response_model=DocumentSchema)
def delete_document(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    current_user: User = Depends(get_current_user)
) -> Document:
    """
    Delete document (soft delete).
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    if document.owner_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    
    document.is_deleted = True
    db.add(document)
    db.commit()
    db.refresh(document)
    return document

@router.get("/{document_id}/collaborators", response_model=List[CollaboratorResponse])
def get_document_collaborators(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    current_user: User = Depends(get_current_user)
) -> List[CollaboratorResponse]:
    """
    Get all collaborators for a document.
    """
    document = db.query(Document).filter(Document.id == document_id, Document.is_deleted == False).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    
    # Check if user has access to the document
    is_collaborator = db.query(DocumentCollaborator).filter(
        DocumentCollaborator.document_id == document_id,
        DocumentCollaborator.user_id == current_user.id
    ).first() is not None
    
    if (
        document.owner_id != current_user.id and
        not document.is_public and
        not is_collaborator
    ):
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    
    # Get collaborators with user details
    collaborators = (
        db.query(User)
        .join(DocumentCollaborator, User.id == DocumentCollaborator.user_id)
        .filter(DocumentCollaborator.document_id == document_id)
        .all()
    )
    
    return [
        CollaboratorResponse(
            user_id=c.id,
            username=c.username,
            email=c.email
        ) for c in collaborators
    ]

@router.post("/{document_id}/collaborators/{user_id}", response_model=List[CollaboratorResponse])
def add_collaborator(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user)
) -> List[CollaboratorResponse]:
    """
    Add a collaborator to the document.
    """
    if current_user.id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Owner can not be collaborator"
        )
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    if document.owner_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    
    # Check if user exists
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )
    
    # Check if already a collaborator
    existing_collaborator = db.query(DocumentCollaborator).filter(
        DocumentCollaborator.document_id == document_id,
        DocumentCollaborator.user_id == user_id
    ).first()
    
    if existing_collaborator:
        raise HTTPException(
            status_code=400,
            detail="User is already a collaborator"
        )
    
    # Add collaborator
    collaborator = DocumentCollaborator(
        document_id=document_id,
        user_id=user_id
    )
    db.add(collaborator)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to add collaborator: {str(e)}"
        )
    
    # Return updated list of collaborators
    return get_document_collaborators(db=db, document_id=document_id, current_user=current_user)

@router.delete("/{document_id}/collaborators/{user_id}", response_model=List[CollaboratorResponse])
def remove_collaborator(
    *,
    db: Session = Depends(get_db),
    document_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user)
) -> List[CollaboratorResponse]:
    """
    Remove a collaborator from the document.
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )
    if document.owner_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Not enough permissions"
        )
    
    # Remove collaborator
    collaborator = db.query(DocumentCollaborator).filter(
        DocumentCollaborator.document_id == document_id,
        DocumentCollaborator.user_id == user_id
    ).first()
    
    if not collaborator:
        raise HTTPException(
            status_code=404,
            detail="User is not a collaborator"
        )
    
    db.delete(collaborator)
    db.commit()
    
    # Return updated list of collaborators
    return get_document_collaborators(db=db, document_id=document_id, current_user=current_user) 