FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY shared/package*.json ./shared/
RUN npm ci

COPY frontend ./frontend
COPY shared ./shared
ARG VITE_WS_BASE_URL=http://localhost:4000
ENV VITE_WS_BASE_URL=$VITE_WS_BASE_URL
RUN npm run build -w shared && npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
