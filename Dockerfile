FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV PORT=6666
ENV NODE_ENV=production

EXPOSE 6666

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:6666/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
