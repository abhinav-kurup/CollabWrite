# CollabWrite Frontend

This is the frontend application for CollabWrite, a real-time collaborative text editor.

## Features

- User authentication (login/register)
- Document management (create, list, delete)
- Real-time collaborative editing
- Add/remove collaborators
- Modern UI with Material-UI components

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Backend server running (see backend README)

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Create a `.env` file in the root directory with the following variables:
```
REACT_APP_API_URL=http://localhost:8000/api/v1
```

3. Start the development server:
```bash
npm start
# or
yarn start
```

The application will be available at http://localhost:3000.

## Development

The frontend is built with:
- React
- TypeScript
- Material-UI
- Monaco Editor
- Yjs for real-time collaboration

### Project Structure

```
src/
  ├── components/     # React components
  ├── contexts/       # React contexts
  ├── services/       # API services
  ├── types/          # TypeScript types
  ├── App.tsx         # Main application component
  └── index.tsx       # Application entry point
```

### Available Scripts

- `npm start` - Start development server
- `npm build` - Build for production
- `npm test` - Run tests
- `npm eject` - Eject from Create React App

## Production Build

To create a production build:

```bash
npm run build
# or
yarn build
```

The build artifacts will be stored in the `build/` directory.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request 