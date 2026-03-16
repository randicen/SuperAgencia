
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Esto asegura que process.env funcione en el cliente para librerías antiguas,
    // aunque Vite usa import.meta.env preferiblemente.
    'process.env': process.env
  }
})
