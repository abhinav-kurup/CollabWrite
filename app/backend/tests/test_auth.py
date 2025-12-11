from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from main import app
from core.config import settings
from core.security import get_password_hash
from models.user import User

client = TestClient(app)

def test_register_user(db: Session):
    response = client.post(
        f"{settings.API_V1_STR}/auth/register",
        json={
            "email": "test@example.com",
            "username": "testuser",
            "password": "testpassword"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test@example.com"
    assert data["username"] == "testuser"
    assert "id" in data

def test_register_existing_email(db: Session):
    # Create a user first
    user = User(
        email="existing@example.com",
        username="existinguser",
        hashed_password=get_password_hash("password")
    )
    db.add(user)
    db.commit()

    # Try to register with the same email
    response = client.post(
        f"{settings.API_V1_STR}/auth/register",
        json={
            "email": "existing@example.com",
            "username": "newuser",
            "password": "password"
        }
    )
    assert response.status_code == 400
    assert "email already exists" in response.json()["detail"].lower()

def test_login_success(db: Session):
    # Create a user first
    user = User(
        email="login@example.com",
        username="loginuser",
        hashed_password=get_password_hash("password")
    )
    db.add(user)
    db.commit()

    # Try to login
    response = client.post(
        f"{settings.API_V1_STR}/auth/login",
        data={
            "username": "loginuser",
            "password": "password"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

def test_login_wrong_password(db: Session):
    # Create a user first
    user = User(
        email="wrong@example.com",
        username="wronguser",
        hashed_password=get_password_hash("password")
    )
    db.add(user)
    db.commit()

    # Try to login with wrong password
    response = client.post(
        f"{settings.API_V1_STR}/auth/login",
        data={
            "username": "wronguser",
            "password": "wrongpassword"
        }
    )
    assert response.status_code == 401
    assert "incorrect username or password" in response.json()["detail"].lower() 