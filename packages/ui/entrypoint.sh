#!/bin/sh

# Generate config.js from environment variables
cat <<EOF > /usr/share/nginx/html/config.js
window.env = {
  API_URL: "${API_URL:-/api}"
};
EOF

# Exec the CMD
exec "$@"
