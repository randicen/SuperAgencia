FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Build frontend
RUN npm run build

# Expose port
EXPOSE 3000

# Run server
CMD ["npm", "start"]
