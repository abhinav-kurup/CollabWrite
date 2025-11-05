"""
Script to run the backend server with proper Python path configuration.
This script ensures that the backend modules can be imported correctly
when running the server separately from the frontend.
"""

import sys
import os

# Add the backend directory to the Python path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

print(f"Backend directory: {backend_dir}")
print(f"Python path: {sys.path}")

# Now import and run the main application
try:
    from main import app
    import uvicorn
    
    if __name__ == "__main__":
        print("Starting backend server...")
        uvicorn.run(
            "main:app",
            host="127.0.0.1",
            port=8000,
            reload=True,
            root_path=backend_dir
        )
        
except ImportError as e:
    print(f"Failed to import main application: {e}")
    print("Make sure all required packages are installed:")
    print("pip install -r requirements.txt")
    sys.exit(1)
except Exception as e:
    print(f"Failed to start server: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)