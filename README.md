# Padel Lobby — sistema de reservas

Sistema completo de reserva de quadras do Padel Lobby (Rio Grande, RS), implementado a partir do design
"Padel Lobby — Reservas Mobile" (4 telas mobile + 3 telas web).

| Camada | Stack |
|---|---|
| Banco | PostgreSQL 16 (`btree_gist`, `pgcrypto`, `citext`) |
| API | Python 3.13 · FastAPI · asyncpg · Pydantic v2 · JWT |
| Web | React 19 · Vite · TypeScript strict · TanStack Query · React Router |

## Rodando localmente

```bash
# 1. Banco (uma vez)
sudo -u postgres psql -c "CREATE ROLE padel LOGIN PASSWORD 'padel' CREATEDB;" -c "CREATE DATABASE padel_lobby OWNER padel;"
sudo -u postgres psql -d padel_lobby -c "CREATE EXTENSION btree_gist; CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;"

# 2. API
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python seed.py              # migrations + configuração + dados demo
.venv/bin/uvicorn app.main:app --reload --port 8000

# 3. Web (outro terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Contas demo: `jogador@padellobby.com.br` / `jogador123` e `admin@padellobby.com.br` / `admin123`.

Produção: `JWT_SECRET=... PIX_WEBHOOK_SECRET=... docker compose up --build` (a API serve o build do React em `:8000`).

Testes: `cd backend && .venv/bin/pytest` (usa o banco `padel_lobby_test`).

## Telas

| Design | Rota | Observação |
|---|---|---|
| 01 · Início / Web 01 | `/` | Dias com status real, livres por quadra, reserva rápida, estrutura, horários, mapa |
| 02 · Escolher horário / Web 02 | `/agenda` | Grade por quadra × hora com intervalo do almoço, 60/90 min |
| 03 · Confirmar e pagar | `/agenda/confirmar` (mobile) · resumo lateral (web) | Jogadores, Pix/cartão/no local, preço por jogador |
| 04 · Minhas reservas / Web 03 | `/reservas` | Próxima reserva com QR de check-in, histórico, filtro, "Repetir" |
| (novas) | `/reservas/:code`, `/convite/:token`, `/entrar`, `/cadastro`, `/perfil`, `/admin` | Pagamento Pix, convite, conta, painel |

Mobile (≤ 760 px) usa o layout do app com barra inferior; acima disso, o layout web.

## Regras de negócio

- **Sem reserva duplicada, garantido pelo banco**: `EXCLUDE USING gist (court_id WITH =, period WITH &&)` sobre reservas ativas. Corridas entre requisições simultâneas viram `409` (há teste com 6 requisições concorrentes).
- **Bloqueios de manutenção**: trigger impede reserva sobre bloqueio; o admin não bloqueia horário com reserva.
- **Máquina de estados** `pending → confirmed → checked_in → completed` (+ `cancelled`/`expired`) validada por trigger, com trilha em `reservation_events`.
- **Funcionamento**: Seg–Sex 12–13h e 14–23h, Sáb 9–21h, Dom fechado; feriados abertos usam o horário de sábado; 90 min não atravessa o intervalo.
- **Preço por faixa**, calculado a cada 30 min (uma reserva pode cruzar faixas): horário promocional, horário nobre e promoção de fim de semana/feriado. **Valores do seed são exemplos** (o design trazia `[VALOR]`) — ajuste em *Admin › Configurações*.
- **Pix**: BR Code EMV com CRC16 e txid; o horário fica seguro por 15 min e expira sozinho (rotina a cada 30 s). Webhook `POST /api/payments/pix/webhook` (cabeçalho `X-Webhook-Secret`), idempotente. Em dev há o botão "Simular pagamento".
- **Cartão** é um gateway simulado (aprova na hora); **no local** confirma e fica "a receber" até o admin marcar "Recebido".
- **Cancelamento** grátis até 6 h antes (configurável) com estorno; depois disso cancela sem estorno.
- **Jogadores**: até 4 por quadra (trigger), convite por link/WhatsApp, quem entra pelo convite vê a reserva.
- Limite de 3 reservas futuras por cliente, janela de 14 dias, lembrete 2 h antes, notificações no sino, `.ics` para agenda.
- **Admin**: receita, ocupação, horas vendidas, receita por dia, ocupação por quadra, mapa de calor, ranking, exportação CSV, agenda do dia, check-in por código (abre 1 h antes), bloqueios, preços, feriados e regras.

## Pendências do design

Ficaram como placeholders, como no design: fotos das quadras (`[FOTO DA QUADRA 1/2]`) e telefone do WhatsApp
(configure em *Admin › Configurações*). Pix e cartão reais exigem um PSP/gateway; o ponto de integração é o webhook acima.
