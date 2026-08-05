#!/bin/bash
echo "Starting CampusFlow..."

# Start backend
cd "D:/Alpha Coders/CampusFlow/packages/backend"
npm run dev &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

# Start frontend
cd "D:/Alpha Coders/CampusFlow/apps/web"
npm run dev &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "Servers running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop both..."

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" EXIT
wait
