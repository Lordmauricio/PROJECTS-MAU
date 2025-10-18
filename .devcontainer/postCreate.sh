#!/usr/bin/env bash
set -e
echo "---- Devcontainer: detectando stack e instalando dependencias ----"

# Node.js
if [ -f package.json ]; then
  echo "Node.js detected (package.json). Installing dependencies..."
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    echo "npm no encontrado."
  fi
fi

# Python
if [ -f requirements.txt ]; then
  echo "Python detected (requirements.txt). Setting up virtualenv and installing deps..."
  python -m venv .venv || python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
fi

echo "---- Hecho. Para iniciar la app en el contenedor intenta uno de estos comandos según corresponda:"
echo "  - npm run dev"
echo "  - npm start"
echo "  - python app.py"
echo "  - flask run --host=0.0.0.0"
echo "Si quieres puedo ajustar el script para tu start exacto.\n\n"(Ensure the script is executable: chmod +x .devcontainer/postCreate.sh)
