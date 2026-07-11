#!/bin/bash
# Start PostgreSQL server for local development
PG_BIN="/tmp/pg_extract/usr/lib/postgresql/17/bin"
PG_CLIENT_BIN="/tmp/pg_client_extract/usr/lib/postgresql/17/bin"
PGDATA="/home/z/.local/pgdata"
PG_SOCKET="/tmp/pg-socket"
export LD_LIBRARY_PATH="/tmp/pg_extract/usr/lib/postgresql/17/lib:/tmp/pg_client_extract/usr/lib/postgresql/17/lib"

# Override DATABASE_URL to ensure PostgreSQL is used (system env might have SQLite URL)
export DATABASE_URL="postgresql://z@localhost:5432/myproject"

# Check if PostgreSQL is already running
if "$PG_CLIENT_BIN/pg_isready" -h localhost -p 5432 -q 2>/dev/null; then
  echo "✅ PostgreSQL is already running on port 5432"
  echo "✅ DATABASE_URL set to: $DATABASE_URL"
  exit 0
fi

# Ensure socket directory exists
mkdir -p "$PG_SOCKET"

# Initialize database if needed
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "📦 Initializing PostgreSQL database..."
  mkdir -p "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" --auth=trust --username=z -L /tmp/pg_extract/usr/share/postgresql/17/ 2>&1
  echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
  echo "port = 5432" >> "$PGDATA/postgresql.conf"
  echo "unix_socket_directories = '$PG_SOCKET'" >> "$PGDATA/postgresql.conf"
fi

# Start PostgreSQL
echo "🚀 Starting PostgreSQL server..."
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-k $PG_SOCKET" start 2>&1

# Wait for it to be ready
for i in {1..10}; do
  if "$PG_CLIENT_BIN/pg_isready" -h localhost -p 5432 -q 2>/dev/null; then
    echo "✅ PostgreSQL started successfully on port 5432"
    echo "✅ DATABASE_URL set to: $DATABASE_URL"
    "$PG_CLIENT_BIN/psql" -h localhost -U z -d postgres -c "SELECT 1 FROM pg_database WHERE datname='myproject'" 2>/dev/null | grep -q 1 || \
      "$PG_CLIENT_BIN/createdb" -h localhost -U z myproject 2>/dev/null
    exit 0
  fi
  sleep 1
done

echo "❌ Failed to start PostgreSQL"
exit 1
