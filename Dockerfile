FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source files
COPY . .

# Create data directory for the JSON database
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
