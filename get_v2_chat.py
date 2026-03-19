import os
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
if response.status_code == 200:
    entries = response.json()
    if entries:
        data = entries[0].get('data', {})
        chat_sessions = data.get('chatSessions', [])
        if chat_sessions:
            last_chat = chat_sessions[-1]
            print(f"Chat Title: {last_chat.get('title')}")
            for msg in last_chat.get('messages', [])[-10:]:
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')
                print(f"--- {role} ---\n{content}\n")
else:
    print(f"Error: {response.status_code} - {response.text}")
