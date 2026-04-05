FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/server.js"]
