FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm install

COPY server/tsconfig.json server/
COPY server/src server/src
COPY client/index.html client/vite.config.ts client/tsconfig.json client/
COPY client/src client/src
COPY client/public client/public

RUN npx tsc -p server/tsconfig.json
RUN npm run build -w client

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "server/dist/index.js"]
