FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-cjk tar && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY demo ./demo
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/data
EXPOSE 4173
CMD ["node", "server.mjs"]
