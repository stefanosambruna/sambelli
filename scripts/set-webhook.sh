#!/usr/bin/env bash
# Registra (o aggiorna) il webhook del bot verso la Edge Function in produzione.
# Uso: scripts/set-webhook.sh <PROJECT_REF>
# Legge TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET da supabase/functions/.env
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:?PROJECT_REF mancante (lo trovi nell'URL del progetto Supabase)}"
set -a; source supabase/functions/.env; set +a
URL="https://${REF}.supabase.co/functions/v1/telegram-webhook"
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"${URL}\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":true}"
echo
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
