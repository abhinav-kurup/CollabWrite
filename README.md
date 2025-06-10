# CollabWrite

A real-time collaborative writing application built with FastAPI, PostgreSQL, and HTMX.

## Features

- Real-time collaborative document editing
- User authentication and authorization
- Document version control
- WebSocket-based real-time updates
- Operational Transformation for conflict resolution

## Tech Stack

- Backend:
  - FastAPI (Python web framework)
  - PostgreSQL (Database)
  - SQLAlchemy (ORM)
  - WebSockets (Real-time communication)
  - JWT (Authentication)

- Frontend:
  - HTMX (Dynamic UI updates)
  - Alpine.js (Interactive components)
  - Bootstrap (Styling)

## Project Structure

```
.
├── app/
│   ├── backend/
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   └── websockets/
│   └── frontend/
│       ├── static/
│       └── templates/
├── tests/
├── docker/
└── docker-compose.yml
```

## Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/collabwrite.git
   cd collabwrite
   ```

2. Set up the development environment:
   ```bash
   # Create and activate virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate

   # Install dependencies
   pip install -r requirements.txt
   ```

3. Start the application using Docker:
   ```bash
   docker-compose up
   ```

4. Access the application at `http://localhost:8000`

## Development

- Backend API documentation is available at `http://localhost:8000/docs`
- Run tests with `pytest`
- Format code with `black`
- Lint code with `flake8`

## License

MIT 