# generate-test-traffic.ps1
# Sends test requests to Tandeba to generate metrics logs

$baseUrl = "https://web-production-0c202.up.railway.app"
$headers = @{
    "Content-Type" = "application/json"
    "X-Tandeba-Stream" = "1"
}

# We need to authenticate first via Clerk
# For testing, we'll hit the health endpoint to confirm connectivity
Write-Host "Testing connectivity to $baseUrl/api/health"
$response = Invoke-WebRequest -Uri "$baseUrl/api/health" -Method GET
Write-Host "Health response: $($response.Content)"

# The /api/chat endpoint requires Clerk auth, so we can't test it directly from CLI
# Instructions: Open the app and send test messages

Write-Host ""
Write-Host "=== INSTRUCCIONES PARA GENERAR MÉTRICAS ==="
Write-Host ""
Write-Host "1. Abre la app en: https://web-production-0c202.up.railway.app"
Write-Host "2. Inicia sesión si no lo estás"
Write-Host "3. Envía los siguientes mensajes en orden:"
Write-Host ""
Write-Host "--- CONVERSATION (3 mensajes) ---"
Write-Host "  a) hola"
Write-Host "  b) que puedes hacer"
Write-Host "  c) gracias"
Write-Host ""
Write-Host "--- PLANNER_READ (4 mensajes) ---"
Write-Host "  d) que tengo hoy"
Write-Host "  e) que tengo esta semana"
Write-Host "  f) resume mi agenda"
Write-Host "  g) que sigue"
Write-Host ""
Write-Host "--- PLANNER_MUTATION (3 mensajes) ---"
Write-Host "  h) agendar reunion de 1 hora a las 3pm"
Write-Host "  i) pon una tarea de programar 2 horas para manana"
Write-Host "  j) elimina la ultima tarea"
Write-Host ""
Write-Host "4. Despues de enviar todos, ejecuta: railway logs"
Write-Host "   para recoger los logs [agena.chat.metrics]"
Write-Host ""
