FROM node:22-slim AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:obfuscate

FROM node:22-slim AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=build /usr/src/app/.build/obfuscate ./
COPY --from=build /usr/src/app/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
