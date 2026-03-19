import os
import requests
import json
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("VITE_SUPABASE_URL")
key = os.getenv("VITE_SUPABASE_KEY")

response = requests.get(f"{url}/rest/v1/app_state_dump?id=eq.coo_master_state_v2&select=data", headers={"apikey": key, "Authorization": f"Bearer {key}"})
data = response.json()[0]["data"]

workspaces = data.get("spaces", {}).get("workspaces", [])
text = "ESTRUCTURA DE WORKSPACES:\n"
for w in workspaces:
    text += f"\n📦 {w.get('nombre')}\n"
    for s in w.get("espacios", []):
        text += f"  📂 {s.get('nombre')}\n"
        for l in s.get("listas", []):
            text += f"    • {l.get('nombre')} ({len(l.get('tareas', []))} tareas)\n"
        for f in s.get("carpetas", []):
            text += f"    📁 {f.get('nombre')}\n"
            for l in f.get("listas", []):
                text += f"      • {l.get('nombre')} ({len(l.get('tareas', []))} tareas)\n"
            if not f.get("listas", []):
                text += "      (vacía)\n"

print("TEXTO PLANO GENERADO:\n" + text)
