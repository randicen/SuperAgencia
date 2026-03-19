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
if response.status_code == 200:
    entries = response.json()
    if entries:
        data = entries[0].get('data', {})
        spaces = data.get('spaces', {})
        
        # Print the full workspaces structure
        workspaces = spaces.get('workspaces', [])
        for ws in workspaces:
            print(f"\n=== WORKSPACE: {ws.get('nombre')} ===")
            for esp in ws.get('espacios', []):
                print(f"  ESPACIO: {esp.get('nombre')} (id: {esp.get('id')})")
                
                # Root-level lists
                for lst in esp.get('listas', []):
                    print(f"    📋 LISTA (raíz): {lst.get('nombre')} (id: {lst.get('id')}, tareas: {len(lst.get('tareas', []))})")
                
                # Folders
                for folder in esp.get('carpetas', []):
                    print(f"    📁 CARPETA: {folder.get('nombre')} (id: {folder.get('id')})")
                    for lst in folder.get('listas', []):
                        print(f"      📋 LISTA: {lst.get('nombre')} (id: {lst.get('id')}, tareas: {len(lst.get('tareas', []))})")
else:
    print(f"Error: {response.status_code}")
