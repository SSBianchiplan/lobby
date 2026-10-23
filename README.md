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

Produção no hub: **https://lobby.gplansis.com** (vps2, venv + systemd + Caddy) — `bash deploy/vps/enviar.sh`
envia, migra, garante o admin master e reinicia. Fora do hub: `JWT_SECRET=... PIX_WEBHOOK_SECRET=... docker compose up --build`
(a API serve o build do React em `:8000`).

Testes: `cd backend && .venv/bin/pytest` (usa o banco `padel_lobby_test`).

## Telas

| Design | Rota | Observação |
|---|---|---|
| 01 · Início / Web 01 | `/` | Dias com status real, livres por quadra, reserva rápida, estrutura, horários, mapa |
| 02 · Escolher horário / Web 02 | `/agenda` | Grade por quadra × hora com intervalo do almoço, 60/90 min |
| 03 · Confirmar e pagar | `/agenda/confirmar` (mobile) · resumo lateral (web) | Jogadores, Pix/cartão/no local, preço por jogador |
| 04 · Minhas reservas / Web 03 | `/reservas` | Próxima reserva com QR de check-in, histórico, filtro, "Repetir" |
| (novas) | `/reservas/:code`, `/convite/:token`, `/entrar`, `/cadastro`, `/perfil`, `/admin` | Pagamento Pix, convite, conta, painel |

### Administração (`/admin`)

| Aba | Rota | O que faz |
|---|---|---|
| Painel | `/admin` | Receita, ocupação, receita por dia, por quadra, mapa de calor, ranking |
| Agenda do dia | `/admin/agenda` | Reservas do dia, check-in por código, bloqueios |
| Agendamentos | `/admin/agendamentos` | Todas as reservas por período, quadra, situação, pagamento e forma; busca; totais; CSV |
| Disponibilidade | `/admin/disponibilidade` | Grade quadras × fatias de 30 min (1, 3 ou 7 dias): livre, pago, a receber, aguardando Pix, bloqueado |
| Pagamentos | `/admin/pagamentos` | A receber (com "Receber" escolhendo dinheiro, Pix no balcão, débito ou crédito), movimento de recebimentos e estornos, totais por forma, CSV |
| Fechamento | `/admin/fechamento` | Caixa do dia: recebido por forma, estornos, dinheiro esperado × contado (sobra/falta), locações do dia, fechar/reabrir com motivo, histórico, dias pendentes, impressão |
| Relatórios | `/admin/relatorios` | Locações por dia, quadra, dia da semana, horário, cliente, forma e duração; ocupação, faturamento, ticket médio; CSV por agrupamento; impressão |
| Usuários | `/admin/usuarios` | Clientes e administradores com histórico de locação; papéis só pelo admin master |
| Configurações | `/admin/config` | Preços, feriados e regras |

**Admin master** (`PADEL_MASTER_ADMINS`, padrão `stefanosbianchi@gmail.com`): sempre administrador, não pode ser
rebaixado e é o único que promove/rebaixa outros admins. Como o cadastro público não verifica e-mail, a conta master
não pode ser criada pela tela de cadastro — nasce no servidor com `python -m app.cli master` (o deploy já roda),
que imprime a senha aleatória uma única vez.

**Fechamento de caixa**: cada lançamento em `payments` tem canal (`pix_online`, `cartao_online`, `dinheiro`,
`pix_balcao`, `debito`, `credito`), quem lançou (`received_by`, só balcão) e data de estorno. Fechado o dia, um
trigger no banco recusa recebimentos de balcão nele; Pix e cartão online nunca são barrados (o dinheiro já entrou) e
aparecem como "movimento após o fechamento". Reabrir exige motivo e fica no histórico do fechamento.

**Limpar dados de exemplo** (*Admin › Configurações*, só o master): mostra a prévia e, com `APAGAR` + senha, apaga numa
transação as contas do seed (`jogador@padellobby.com.br` e `*@exemplo.com`, papel jogador) e tudo o que é delas —
reservas, pagamentos, jogadores, eventos, notificações — e os fechamentos de dias com dinheiro de exemplo. Admins,
configurações, preços, feriados, quadras, bloqueios e dados reais ficam.

### Conta do usuário

- **Criar conta** (`/cadastro`): senha de 8+ caracteres com medidor de força e confirmação, perfil de jogador opcional
  (categoria iniciante/6ª–1ª, lado, mão dominante, cidade) e aceite obrigatório dos [termos e privacidade](/termos).
- **Perfil** (`/perfil`): estatísticas (jogos, horas, gasto, quadra favorita, próximas), parceiros frequentes, dados
  pessoais, perfil de jogador, troca de senha (exige a atual), "sair de todos os aparelhos", baixar meus dados (JSON)
  e excluir conta — a exclusão anonimiza nome/e-mail/telefone e mantém reservas e pagamentos sem identificação.
- **Sessão**: o JWT leva `tv` (versão da sessão); trocar senha, sair de todos, redefinição pela recepção ou exclusão
  incrementam `users.token_version` e derrubam os tokens antigos. Login trava 5 min após 5 senhas erradas no mesmo e-mail.
- **Esqueci a senha** (não há envio de e-mail): a recepção gera uma senha temporária em *Admin › Usuários*; no próximo
  acesso a troca é obrigatória. Admin comum redefine jogadores; só o master redefine outros admins; a do master, ninguém.
- **Card iaVision** (home web e mobile, perfil): CTA para [GPlanSiS|iaVision](https://aivision.gplansis.com) — visão
  computacional e IA na análise de atletas e partidas, online e offline, relatórios de biomecânica e desempenho.

### PWA

Instalável no celular ("Adicionar à tela inicial"): `manifest.webmanifest`, ícones normais e *maskable*,
`apple-touch-icon`, favicon e um service worker (`public/sw.js`) que guarda a casca do app para abrir sem rede.
A API nunca é cacheada.

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
