# app/backend/exceptions.py

class AuthenticationError(Exception):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message)
        self.message = message
