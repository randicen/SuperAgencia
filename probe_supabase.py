import os
import time
import requests
import json
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("VITE_SUPABASE_URL")
key = os.getenv("VITE_SUPABASE_KEY")

endpoint = f"{url}/rest/v1/app_state_dump?id=eq.coo_master_state&select=data"

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

print(f"Monitoring Supabase at {url}")
last_mod = 0

while True:
    try:
        response = requests.get(endpoint, headers=headers)
        if response.status_code == 200:
            entries = response.json()
            if len(entries) > 0:
                data = entries[0].get('data', {})
                current_mod = data.get('lastModified', 0)
                
                if current_mod != last_mod:
                    print(f"\n[{time.strftime('%X')}] 🔥 NEW STATE DETECTED! LastMod: {current_mod}")
                    last_mod = current_mod
                    
                    chat_sessions = data.get('chatSessions', [])
                    print(f"Total Chat Sessions: {len(chat_sessions)}")
                    if chat_sessions:
                        last_chat = chat_sessions[-1]
                        msgs = last_chat.get('messages', [])
                        print(f"Total Messages in last chat: {len(msgs)}")
                        if msgs:
                            print(f"Last Msg preview: {msgs[-1].get('content', '')[:100]}...")
                            print(f"Msg length: {len(msgs[-1].get('content', ''))}")
                            
        time.sleep(0.5)
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(2)
