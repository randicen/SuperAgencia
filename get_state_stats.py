import os
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("VITE_SUPABASE_URL")
key = os.getenv("VITE_SUPABASE_KEY")

def get_stats(record_id):
    endpoint = f"{url}/rest/v1/app_state_dump?id=eq.{record_id}&select=data"
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
            print(f"ID {record_id}: {len(chat_sessions)} chat sessions, {len(data.get('projects', []))} projects")
            if chat_sessions:
                last_chat = chat_sessions[-1]
                print(f"  Last chat in {record_id} has {len(last_chat.get('messages', []))} messages")
        else:
            print(f"ID {record_id}: Not found")
    else:
        print(f"ID {record_id}: Error {response.status_code}")

get_stats("coo_master_state")
get_stats("coo_master_state_v2")
