FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY shared/package*.json ./shared/
RUN npm ci

COPY backend ./backend
COPY shared ./shared
RUN npm run build -w shared && npm run build -w backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY shared/package*.json ./shared/
RUN npm ci --omit=dev

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/shared/dist ./shared/dist

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "backend"]
