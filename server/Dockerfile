FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY dist ./dist
COPY migrations ./migrations

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "dist/index.js"]
