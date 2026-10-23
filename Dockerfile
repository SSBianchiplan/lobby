FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV PADEL_DEV_MODE=false
EXPOSE 8000
CMD ["sh", "-c", "python seed.py --no-demo && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
