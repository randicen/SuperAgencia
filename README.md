<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# COO/CFO in a Box

Tu asistente personal de IA para gestionar una agencia unipersonal. Coordina proyectos, gestiona clientes y controla finanzas automáticamente.

## ✨ Características

- **🤖 Director AI**: Asistente IA que entiende lenguaje natural y ejecuta acciones
- **📊 Dashboard**: Vista ejecutiva con métricas clave
- **📅 Gantt**: Visualización de proyectos en timeline
- **💰 Finanzas**: Control de flujo de caja, clientes y cuotas
- **🏢 Spaces**: Workspaces múltiples para diferentes negocios
- **⚙️ Configuración**: Personaliza tarifas, capacidad y reglas de negocio

## 🚀 Ejecutar Localmente

**Prerequisites:** Node.js

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar API Key de Groq en .env.local
# Obtén tu key gratis en: https://console.groq.com
VITE_GROQ_API_KEY=tu_api_key_aqui

# 3. Ejecutar
npm run dev
```

## 🛠️ Stack

- **Frontend**: React 19 + Vite + TypeScript
- **IA**: Groq (GPT-OSS 120B) con function calling
- **Estilos**: Tailwind CSS
- **Gráficos**: Recharts
- **Persistencia**: LocalStorage (temporal) / Supabase (opcional)

## 📡 APIs Utilizadas

- **Groq API**: Motor de IA (modelo: `openai/gpt-oss-120b`)
- **Supabase** (opcional): Persistencia de datos

## 🌐 Despliegue

El proyecto está desplegado en: https://superagencia.eduhootie.com

## 📝 Licencia

MIT
