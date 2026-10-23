#!/usr/bin/env bash
# Publica o Padel Lobby na vps2 (Hostinger): venv + systemd + Caddy, sem Docker,
# seguindo o padrão do hub gplansis.com. Idempotente: roda de novo para atualizar.
#
#   bash deploy/vps/enviar.sh              # build do front, envia, migra, reinicia
#   bash deploy/vps/enviar.sh --so-codigo  # só build + rsync + restart (sem Caddy/banco)
#
# Na primeira vez cria o banco com dados de demonstração e troca a senha do admin
# (a do seed é pública no README) por uma aleatória, impressa uma única vez.
#
# Pré-requisitos: `ssh vps2` funcionando (AdminGPlanSIS/bin/instalar-ssh-config) e Node local.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${HOST:-vps2}"
APP=padel-lobby
DB=padel_lobby   # papel e banco no Postgres (sem hífen)
DIR=/opt/$APP
PORTA=8460
DOMINIO=lobby.gplansis.com
SO_CODIGO="${1:-}"

echo "▶ build do frontend"
(cd frontend && npm ci --no-audit --no-fund --silent && npm run build --silent)

echo "▶ enviando código para $HOST:$DIR"
ssh "$HOST" "id -u $APP >/dev/null 2>&1 || useradd --system --home-dir $DIR --shell /usr/sbin/nologin $APP; mkdir -p $DIR"
rsync -az --delete \
  --exclude .venv --exclude backend/.env --exclude __pycache__ --exclude .pytest_cache --exclude .git \
  --exclude node_modules --exclude .vscode --exclude '*.log' \
  ./ "$HOST:$DIR/"

echo "▶ dependências (venv)"
ssh "$HOST" "cd $DIR && ([ -d .venv ] || python3 -m venv .venv) && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r backend/requirements.txt"

if [ "$SO_CODIGO" != "--so-codigo" ]; then
  echo "▶ banco de dados e .env"
  ssh "$HOST" bash -s <<REMOTO
set -euo pipefail
ENV=$DIR/backend/.env
PRIMEIRA=0
if [ ! -f \$ENV ]; then
  PRIMEIRA=1
  SENHA_DB=\$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)
  sudo -u postgres psql -qv ON_ERROR_STOP=1 -c "CREATE ROLE $DB LOGIN PASSWORD '\$SENHA_DB'" 2>/dev/null \
    || sudo -u postgres psql -qv ON_ERROR_STOP=1 -c "ALTER ROLE $DB PASSWORD '\$SENHA_DB'"
  sudo -u postgres psql -qv ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER $DB" 2>/dev/null || true
  cat > \$ENV <<ENVF
PADEL_DATABASE_URL=postgresql://$DB:\$SENHA_DB@127.0.0.1:5432/$DB
PADEL_JWT_SECRET=\$(openssl rand -base64 64 | tr -d '/+=\n' | cut -c1-64)
PADEL_PIX_WEBHOOK_SECRET=\$(openssl rand -hex 24)
PADEL_TIMEZONE=America/Sao_Paulo
# true: mantém o botão "Simular pagamento" (não há PSP Pix real integrado ainda).
PADEL_DEV_MODE=true
PADEL_CORS_ORIGINS=["https://$DOMINIO"]
ENVF
  echo "  .env criado."
else
  echo "  .env já existe, mantido."
fi
# Extensões exigem superusuário; o resto do schema é do dono do banco.
sudo -u postgres psql -qd $DB -c "CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;"
chown -R root:$APP $DIR; chmod -R u+rwX,g+rX,o-rwx $DIR; chmod 640 \$ENV
cd $DIR/backend
if [ \$PRIMEIRA = 1 ]; then
  sudo -u $APP $DIR/.venv/bin/python seed.py >/dev/null
  SENHA_ADMIN=\$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-18)
  sudo -u $APP SENHA_ADMIN="\$SENHA_ADMIN" $DIR/.venv/bin/python - <<'PY'
import asyncio, os
from app import db
from app.security import hash_password
async def main():
    pool = await db.connect()
    await pool.execute("UPDATE users SET password_hash = \$1 WHERE email = 'admin@padellobby.com.br'",
                       hash_password(os.environ["SENHA_ADMIN"]))
    await db.close()
asyncio.run(main())
PY
  echo "  banco semeado com demo. Admin: admin@padellobby.com.br / \$SENHA_ADMIN  (anote: não será mostrada de novo)"
else
  sudo -u $APP $DIR/.venv/bin/python seed.py --no-demo >/dev/null
fi
# Admin master (PADEL_MASTER_ADMINS): cria com senha aleatória na primeira vez, promove se preciso.
sudo -u $APP $DIR/.venv/bin/python -m app.cli master
REMOTO

  echo "▶ systemd + caddy"
  ssh "$HOST" bash -s <<REMOTO
set -euo pipefail
install -m 644 $DIR/deploy/vps/$APP.service /etc/systemd/system/$APP.service
install -m 644 $DIR/deploy/vps/$APP.caddy /etc/caddy/$APP.caddy
install -m 640 -o caddy -g caddy /dev/null /var/log/caddy/$APP.log 2>/dev/null || { touch /var/log/caddy/$APP.log; chown caddy:caddy /var/log/caddy/$APP.log; }
grep -q "import /etc/caddy/$APP.caddy" /etc/caddy/Caddyfile || {
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$APP-\$(date +%Y%m%d-%H%M%S)
  printf '\n# Padel Lobby — lobby.gplansis.com\nimport /etc/caddy/%s.caddy\n' $APP >> /etc/caddy/Caddyfile
}
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1
systemctl daemon-reload
systemctl enable -q $APP
systemctl reload caddy
REMOTO
fi

echo "▶ reiniciando serviço"
ssh "$HOST" "chown -R root:$APP $DIR; chmod -R u+rwX,g+rX,o-rwx $DIR; chmod 640 $DIR/backend/.env; systemctl restart $APP; sleep 3; systemctl is-active $APP; curl -s http://127.0.0.1:$PORTA/api/health; echo"
echo "▶ verificação externa"
IP=$(dig +short $DOMINIO A | head -1 || true)
echo "  DNS $DOMINIO -> ${IP:-(sem registro A: crie no hPanel apontando para 2.25.179.119)}"
curl -s -o /dev/null -w "  https://$DOMINIO -> %{http_code}\n" --max-time 30 "https://$DOMINIO/api/health" || true
echo "✔ pronto"
