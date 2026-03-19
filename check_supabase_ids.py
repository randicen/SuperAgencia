import os
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")
url = os.getenv("VITE_SUPABASE_URL")
key = os.getenv("VITE_SUPABASE_KEY")

def check_id(record_id):
    endpoint = f"{url}/rest/v1/app_state_dump?id=eq.{record_id}&select=data"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    response = requests.get(endpoint, headers=headers)
    if response.status_code == 200:
        entries = response.json()
        print(f"ID {record_id}: Found {len(entries)} records")
        if entries:
            data = entries[0].get('data', {})
            print(f"  LastModified: {data.get('lastModified')}")
    else:
        print(f"ID {record_id}: Error {response.status_code}")

check_id("coo_master_state")
check_id("coo_master_state_v2")
