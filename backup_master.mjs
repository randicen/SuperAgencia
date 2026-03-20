import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';

const SUPABASE_URL = 'https://kpauvbelnstbprvnnbaz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYXV2YmVsbnN0YnBydm5uYmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MDQ0MTUsImV4cCI6MjA4OTI4MDQxNX0.wmrs6PWhlzBCtros7xOoNWH7ZYMD-HnA5QAGPM8IpIA';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backup() {
  console.log('Descargando app_state_dump...');
  const { data, error } = await supabase.from('app_state_dump').select('*');
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  await fs.writeFile('backup_app_state_dump.json', JSON.stringify(data, null, 2));
  console.log('¡Respaldo JSON Master exitoso!');
}

backup().catch(console.error);
