FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Expose port
ENV PORT=3000
EXPOSE 3000

# Run server
CMD ["npm", "start"]
