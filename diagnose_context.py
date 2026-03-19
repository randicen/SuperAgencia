import os
import json
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("VITE_SUPABASE_URL")
key = os.getenv("VITE_SUPABASE_KEY")

endpoint = f"{url}/rest/v1/app_state_dump?id=eq.coo_master_state_v2&select=data"
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

response = requests.get(endpoint, headers=headers)
entries = response.json()
data = entries[0].get('data', {})
spaces = data.get('spaces', {})

# Build the EXACT context the AI receives
workspaces = spaces.get('workspaces', [])

contextData = {
    "workspaces": []
}

for w in workspaces:
    ws_obj = {"nombre": w.get("nombre"), "espacios": []}
    for s in w.get("espacios", []):
        esp_obj = {
            "nombre": s.get("nombre"),
            "listasRaiz": [{"nombre": l.get("nombre"), "tareas": len(l.get("tareas", []))} for l in s.get("listas", [])],
            "carpetas": [{
                "nombre": f.get("nombre"),
                "listas": [{"nombre": l.get("nombre"), "tareas": len(l.get("tareas", []))} for l in f.get("listas", [])]
            } for f in s.get("carpetas", [])]
        }
        ws_obj["espacios"].append(esp_obj)
    contextData["workspaces"].append(ws_obj)

print("=== EXACT JSON CONTEXT SENT TO AI ===")
print(json.dumps(contextData, indent=2, ensure_ascii=False))

# Also check last chat messages for stale data
chat_sessions = data.get('chatSessions', [])
if chat_sessions:
    last_chat = chat_sessions[-1]
    msgs = last_chat.get('messages', [])
    print(f"\n=== LAST {min(6, len(msgs))} CHAT MESSAGES ===")
    for msg in msgs[-6:]:
        role = msg.get('role', '?')
        content = msg.get('content', '')[:200]
        has_actions = bool(msg.get('pendingActions') or msg.get('executedActions'))
        print(f"[{role}] {content}{'...(truncated)' if len(msg.get('content',''))>200 else ''}")
        if has_actions:
            actions = msg.get('pendingActions', []) or msg.get('executedActions', [])
            for a in actions:
                print(f"  -> ACTION: {a.get('name')} {json.dumps(a.get('args',{}))}")
        print()
